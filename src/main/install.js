'use strict'
// Подготовка версии к запуску: собираем ВСЁ, что нужно скачать (Java, клиент,
// библиотеки, нативные файлы, Fabric, звуки и текстуры, настройки логов),
// проверяем, что уже есть, и качаем одной очередью с общим прогрессом.
// После этого minecraft-launcher-core находит все файлы на месте и сеть ему не нужна.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { fetchJson, download, abortAll, MOCK } = require('./net')
const { installJava } = require('./java')
const language = require('./language')

const ASSETS_HOST = 'https://resources.download.minecraft.net'
const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
const ARCH = process.arch === 'ia32' ? '32' : '64'
const CONCURRENCY = 8
const ATTEMPTS = 3

function sha1File (file) {
  return new Promise(resolve => {
    const h = crypto.createHash('sha1')
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(null))
  })
}

function fileSize (file) {
  try { return fs.statSync(file).size } catch { return -1 }
}

// Правила библиотек из JSON версии: берём только нужное для этой ОС.
function libAllowed (lib) {
  if (!lib.rules) return true
  let ok = false
  for (const r of lib.rules) {
    const match = !r.os || !r.os.name || r.os.name === OS || (OS === 'osx' && r.os.name === 'macos')
    if (match) ok = r.action === 'allow'
  }
  return ok
}

// "group:artifact:version[:classifier]" → путь в maven-репозитории
function mavenPath (name) {
  const [group, artifact, version, classifier] = name.split(':')
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

/**
 * Собирает список загрузок.
 * ctx: { root, vmeta, dirName, fabricJson, java (план из planJava или null) }
 */
async function plan (ctx) {
  const { root, vmeta, dirName, fabricJson } = ctx
  const jobs = []
  const add = job => jobs.push(job)

  if (ctx.java && !ctx.java.ready) {
    add({ kind: 'java', url: ctx.java.url, file: ctx.java.archive, size: ctx.java.size, hash: ctx.java.sha256 ? { algo: 'sha256', value: ctx.java.sha256 } : null, always: true })
  }

  const client = vmeta.downloads && vmeta.downloads.client
  if (client && client.url) {
    add({ kind: 'client', url: client.url, file: path.join(root, 'versions', dirName, `${dirName}.jar`), size: client.size || 0, sha1: client.sha1 })
  }

  // Нативные файлы для версий до 1.19 лежат отдельными архивами (classifiers).
  const natives = []
  for (const lib of vmeta.libraries || []) {
    if (!libAllowed(lib)) continue
    const d = lib.downloads || {}
    if (d.artifact && d.artifact.url && d.artifact.path) {
      add({ kind: 'lib', url: d.artifact.url, file: path.join(root, 'libraries', d.artifact.path), size: d.artifact.size || 0, sha1: d.artifact.sha1 })
    }
    const key = lib.natives && lib.natives[OS] && lib.natives[OS].replace('${arch}', ARCH)
    const nat = key && d.classifiers && d.classifiers[key]
    if (nat && nat.url && nat.path) {
      const job = { kind: 'native', url: nat.url, file: path.join(root, 'libraries', nat.path), size: nat.size || 0, sha1: nat.sha1 }
      add(job)
      natives.push(job.file)
    }
  }

  // Библиотеки Fabric (у новых профилей есть размер и sha1, у старых — нет).
  if (fabricJson) {
    for (const lib of fabricJson.libraries || []) {
      if (!lib.name || !lib.url) continue
      const rel = mavenPath(lib.name)
      add({ kind: 'fabric', url: lib.url.replace(/\/?$/, '/') + rel, file: path.join(root, 'libraries', rel), size: lib.size || 0, sha1: lib.sha1 || null, estimate: !lib.size })
    }
  }

  // Настройки логов от Mojang (с исправлением уязвимости Log4Shell).
  let logConfig = null
  const lc = vmeta.logging && vmeta.logging.client && vmeta.logging.client.file
  if (lc && lc.url && lc.id) {
    logConfig = path.join(root, 'assets', 'log_configs', path.basename(lc.id))
    add({ kind: 'log', url: lc.url, file: logConfig, size: lc.size || 0, sha1: lc.sha1 })
  }

  // Звуки и текстуры. Список берём из индекса и кладём туда, где его ищет MCLC.
  let langStyle = 'lower'
  const ai = vmeta.assetIndex
  if (ai && ai.url) {
    // MCLC ищет индекс под именем версии (у Fabric — под именем профиля).
    const indexFile = path.join(root, "assets", "indexes", `${dirName}.json`)
    let index = null
    try {
      index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
      if (ai.sha1 && !MOCK && (await sha1File(indexFile)) !== ai.sha1) index = null
    } catch { index = null }
    if (!index) {
      index = await fetchJson(ai.url)
      fs.mkdirSync(path.dirname(indexFile), { recursive: true })
      fs.writeFileSync(indexFile, JSON.stringify(index))
    }
    langStyle = language.styleFromIndex(index)
    const seen = new Set()
    for (const obj of Object.values(index.objects || {})) {
      if (!obj || !obj.hash || seen.has(obj.hash)) continue
      seen.add(obj.hash)
      const sub = obj.hash.slice(0, 2)
      add({ kind: 'asset', url: `${ASSETS_HOST}/${sub}/${obj.hash}`, file: path.join(root, 'assets', 'objects', sub, obj.hash), size: obj.size || 0, sha1: obj.hash, sizeOnly: true })
    }
  }

  // Один файл — одна загрузка (некоторые библиотеки повторяются у Fabric и ванилы).
  const unique = new Map()
  for (const j of jobs) if (!unique.has(j.file)) unique.set(j.file, j)

  return {
    jobs: [...unique.values()],
    natives,
    nativesDir: path.join(root, 'natives', vmeta.id),
    logConfig,
    langStyle,
    java: ctx.java
  }
}

// Нужно ли качать файл. Большие и важные — по sha1, звуки — по размеру (их тысячи).
async function needsDownload (job) {
  if (job.always) return true
  const size = fileSize(job.file)
  if (size < 0) return true
  if (MOCK) return false
  if (job.size && size !== job.size) return true
  if (job.sizeOnly || !job.sha1 || MOCK) return false
  return (await sha1File(job.file)) !== job.sha1
}

async function extractNatives (planned) {
  const dir = planned.nativesDir
  const marker = path.join(dir, '.astra-natives')
  if (!planned.natives.length || fs.existsSync(marker)) return
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  if (!MOCK) {
    const extractZip = require('extract-zip')
    for (const jar of planned.natives) await extractZip(jar, { dir: path.resolve(dir) })
    fs.rmSync(path.join(dir, 'META-INF'), { recursive: true, force: true })
  }
  fs.writeFileSync(marker, String(Date.now()))
}

/**
 * Проверка и загрузка. progress — экземпляр Progress, isCancelled — () => boolean.
 * Возвращает путь к Java, если она скачивалась.
 */
async function run (planned, progress, isCancelled) {
  const check = () => { if (isCancelled()) throw new Error('Запуск отменён') }

  // 1. Проверка того, что уже скачано. Если всё на месте (обычный повторный запуск),
  // проверка занимает всю шкалу; если чего-то нет — первые 6 %, остальное — загрузка.
  const allPresent = planned.jobs.every(j => !j.always && fileSize(j.file) >= 0 && (!j.size || fileSize(j.file) === j.size || MOCK))
  progress.range(0, allPresent ? 100 : 6)
  progress.countStart(planned.jobs.length, 'Проверяю файлы игры')
  const todo = []
  let i = 0
  const checker = async () => {
    while (i < planned.jobs.length) {
      const job = planned.jobs[i++]
      if (await needsDownload(job)) todo.push(job)
      progress.countTick()
    }
  }
  await Promise.all(Array.from({ length: 4 }, checker))
  check()

  // 2. Загрузка всего недостающего одной очередью (6–100 %).
  // Распаковка Java тоже входит в шкалу: считаем её как треть размера архива.
  const javaJob = todo.find(j => j.kind === 'java')
  const unpackWeight = javaJob ? Math.round((javaJob.size || 40 * 1048576) / 3) : 0
  const estimate = 400 * 1024
  const total = todo.reduce((n, j) => n + (j.size || estimate), 0) + unpackWeight

  progress.range(6, 94)
  if (todo.length) {
    progress.bytesStart(total, 'Скачиваю файлы игры')
    // Крупные файлы — первыми, чтобы в конце не ждать один большой.
    todo.sort((a, b) => (b.size || estimate) - (a.size || estimate))
    let next = 0
    let failed = null
    const worker = async () => {
      while (!failed && next < todo.length) {
        const job = todo[next++]
        const expected = job.size || estimate
        for (let attempt = 1; ; attempt++) {
          if (isCancelled()) throw new Error('Запуск отменён')
          try {
            let real = 0
            await download(job.url, job.file, {
              hash: job.hash || (job.sha1 ? { algo: 'sha1', value: job.sha1 } : null),
              onProgress: (cur, len) => {
                real = len || cur
                progress.partial(job, Math.min(cur, expected))
              }
            })
            if (job.estimate && real && real !== expected) progress.adjustTotal(real - expected)
            progress.fileDone(job, job.estimate && real ? real : expected)
            break
          } catch (e) {
            progress.fileRetry(job)
            if (isCancelled() || attempt >= ATTEMPTS) throw e
            await new Promise(r => setTimeout(r, 600 * attempt))
          }
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
        try { await worker() } catch (e) { if (!failed) failed = e; abortAll('game') }
      }))
    } finally {
      if (failed) throw (isCancelled() ? new Error('Запуск отменён') : failed)
    }
    check()
  }

  // 3. Распаковка.
  let javaPath = null
  if (planned.java && !planned.java.ready) {
    progress.setStage(`Распаковываю Java ${planned.java.major}`, true)
    javaPath = await installJava(planned.java)
    progress.fileDone('java-unpack', unpackWeight)
  } else if (planned.java && planned.java.ready) {
    javaPath = planned.java.ready
  }
  await extractNatives(planned)
  check()
  return javaPath
}

module.exports = { plan, run, libAllowed, mavenPath }
