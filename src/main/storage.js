'use strict'
// «Место на диске»: что сколько занимает и что можно удалить без вреда.
// Лишнее — то, что не нужно ни одной скачанной версии: старые библиотеки,
// звуки и текстуры удалённых версий, ненужная Java, логи и временные файлы.
// Всё лишнее при необходимости скачается снова; миры здесь не удаляются никогда.
const fs = require('fs')
const path = require('path')
const settings = require('./settings')
const versions = require('./versions')
const modpacks = require('./modpacks')
const { instancesDir } = require('./profiles')

function walkFiles (dir, onFile) {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) { let size = 0; try { size = fs.statSync(p).size } catch {} onFile(p, size) }
    }
  }
}

function dirSize (dir) {
  let total = 0
  walkFiles(dir, (_p, s) => { total += s })
  return total
}

function list (dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
}

function mavenPath (name) {
  const [group, artifact, version, classifier] = String(name).split(':')
  if (!group || !artifact || !version) return null
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`
}

// Всё, что нужно скачанным версиям: библиотеки, индексы звуков, Java, папки natives.
function referenced (root) {
  const libs = new Set()
  const indexes = new Set()
  const javas = new Set()
  const dirs = new Set()
  const vdir = path.join(root, 'versions')
  for (const d of list(vdir)) {
    if (!d.isDirectory()) continue
    dirs.add(d.name)
    indexes.add(d.name + '.json')
    for (const f of list(path.join(vdir, d.name))) {
      if (!f.name.endsWith('.json')) continue
      const j = versions.readJsonSafe(path.join(vdir, d.name, f.name))
      if (!j) continue
      if (j.id) dirs.add(j.id)
      if (j.assets) indexes.add(j.assets + '.json')
      if (j.downloads && j.downloads.client) {
        const major = (j.javaVersion && j.javaVersion.majorVersion) || 8
        javas.add(major === 16 ? 17 : major)
      }
      for (const lib of j.libraries || []) {
        const dl = lib.downloads || {}
        if (dl.artifact && dl.artifact.path) libs.add(path.normalize(dl.artifact.path))
        for (const c of Object.values(dl.classifiers || {})) if (c && c.path) libs.add(path.normalize(c.path))
        if (lib.name && !dl.artifact) { const m = mavenPath(lib.name); if (m) libs.add(path.normalize(m)) }
      }
    }
  }
  return { libs, indexes, javas, dirs }
}

// Хеши звуков и текстур, которые нужны оставшимся версиям.
function neededAssets (root, indexes) {
  const hashes = new Set()
  for (const name of indexes) {
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'indexes', name), 'utf8'))
      for (const o of Object.values(idx.objects || {})) if (o && o.hash) hashes.add(o.hash)
    } catch {}
  }
  return hashes
}

// Папка общая с другим лаунчером (например, выбрана .minecraft)? Тогда его библиотеки
// и звуки нам не видны — они описаны в его файлах, — и трогать их нельзя.
function sharedWithOtherLauncher (root) {
  return ['launcher_profiles.json', 'TlauncherProfiles.json', 'tlauncher-2.0.properties'].some(f => fs.existsSync(path.join(root, f)))
}

// Список лишних файлов по видам.
function junk (root) {
  const ref = referenced(root)
  const out = { libs: [], assets: [], logs: [], temp: [] }
  const add = (kind, p, size) => out[kind].push({ p, size })
  const shared = sharedWithOtherLauncher(root)

  const libRoot = path.join(root, 'libraries')
  if (!shared) walkFiles(libRoot, (p, size) => { if (!ref.libs.has(path.relative(libRoot, p))) add('libs', p, size) })

  const idxDir = path.join(root, 'assets', 'indexes')
  if (!shared) {
    const keepIdx = new Set([...ref.indexes].filter(n => fs.existsSync(path.join(idxDir, n))))
    for (const f of list(idxDir)) if (f.isFile() && !keepIdx.has(f.name)) { add('assets', path.join(idxDir, f.name), fs.statSync(path.join(idxDir, f.name)).size) }
    const need = neededAssets(root, keepIdx)
    const objDir = path.join(root, 'assets', 'objects')
    walkFiles(objDir, (p, size) => { if (!need.has(path.basename(p))) add('assets', p, size) })
  }

  // Логи и отчёты о вылетах в сборках (latest.log оставляем).
  const inst = instancesDir()
  for (const d of list(inst)) {
    if (!d.isDirectory()) continue
    const base = path.join(inst, d.name)
    walkFiles(path.join(base, 'logs'), (p, size) => { if (path.basename(p) !== 'latest.log') add('logs', p, size) })
    walkFiles(path.join(base, 'crash-reports'), (p, size) => add('logs', p, size))
    for (const f of list(base)) if (f.isFile() && /^hs_err_pid\d+\.log$/.test(f.name)) add('logs', path.join(base, f.name), fs.statSync(path.join(base, f.name)).size)
    if (/^\.tmp-pack-/.test(d.name) && old(base)) walkFiles(base, (p, size) => add('temp', p, size))
  }
  // Распакованные нативные файлы удалённых версий и недокачанные файлы.
  for (const d of list(path.join(root, 'natives'))) {
    if (d.isDirectory() && !ref.dirs.has(d.name)) walkFiles(path.join(root, 'natives', d.name), (p, size) => add('temp', p, size))
  }
  for (const sub of ['versions', 'libraries', 'runtime', 'assets']) {
    walkFiles(path.join(root, sub), (p, size) => { if (/\.[0-9a-f]{8}\.part$/.test(p) && old(p)) add('temp', p, size) })
  }
  return { out, ref, shared }
}

// Свежие временные файлы не трогаем: возможно, прямо сейчас идёт загрузка.
const old = p => { try { return Date.now() - fs.statSync(p).mtimeMs > 3600e3 } catch { return false } }

const sum = arr => arr.reduce((n, x) => n + x.size, 0)

function freeDisk (dir) {
  try { const st = fs.statfsSync(dir); return st.bavail * st.bsize } catch { return null }
}

async function scan () {
  const root = settings.gameDir()
  const { out, ref, shared } = junk(root)
  const s = settings.load()

  // Версии: обычная и её профили Fabric — одной строкой.
  const vdir = path.join(root, 'versions')
  const byVersion = {}
  for (const d of list(vdir)) {
    if (!d.isDirectory()) continue
    let base = d.name
    if (d.name.startsWith('fabric-loader-')) {
      const j = versions.readJsonSafe(path.join(vdir, d.name, `${d.name}.json`))
      base = (j && j.inheritsFrom) || base
    }
    byVersion[base] = (byVersion[base] || 0) + dirSize(path.join(vdir, d.name))
  }

  const packs = Object.fromEntries(modpacks.list().map(p => [`pack-${p.id}`, p]))
  const instances = list(instancesDir()).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => {
    const dir = path.join(instancesDir(), d.name)
    const pk = packs[d.name]
    const worlds = list(path.join(dir, 'saves')).filter(w => w.isDirectory()).length
    return {
      id: d.name,
      label: pk ? `Сборка «${pk.name}»` : d.name.endsWith('-fabric') ? d.name.replace(/-fabric$/, ' + Fabric') : d.name,
      size: dirSize(dir),
      backups: dirSize(path.join(dir, 'backups')),
      worlds,
      pack: pk ? pk.id : null
    }
  }).sort((a, b) => b.size - a.size)

  const java = list(path.join(root, 'runtime')).filter(d => d.isDirectory() && /^java-\d+$/.test(d.name)).map(d => {
    const major = Number(d.name.slice(5))
    // Со своей Java в настройках скачанные лаунчером не трогаем вовсе (так же, как clean).
    const needed = ref.javas.has(major) || !!s.javaPath
    return { id: d.name, label: `Java ${major}`, size: dirSize(path.join(root, 'runtime', d.name)), needed }
  })

  return {
    gameDir: root,
    shared,
    free: freeDisk(root),
    versions: Object.entries(byVersion).map(([id, size]) => ({ id, size })).sort((a, b) => b.size - a.size),
    instances,
    java,
    junk: {
      libs: sum(out.libs),
      assets: sum(out.assets),
      logs: sum(out.logs),
      temp: sum(out.temp),
      java: java.filter(j => !j.needed).reduce((n, j) => n + j.size, 0)
    }
  }
}

function removeEmptyDirs (dir) {
  let empty = true
  for (const e of list(dir)) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!removeEmptyDirs(p)) empty = false } else empty = false
  }
  if (empty) { try { fs.rmdirSync(dir) } catch {} }
  return empty
}

// Удаляет лишнее. kinds — какие виды: libs, assets, logs, temp, java.
function clean (kinds = ['libs', 'assets', 'logs', 'temp', 'java']) {
  const root = settings.gameDir()
  const { out, ref } = junk(root)
  let freed = 0
  for (const kind of ['libs', 'assets', 'logs', 'temp']) {
    if (!kinds.includes(kind)) continue
    for (const f of out[kind]) {
      try { fs.rmSync(f.p, { force: true }); freed += f.size } catch {}
    }
  }
  if (kinds.includes('java') && !settings.load().javaPath) {
    for (const d of list(path.join(root, 'runtime'))) {
      if (!d.isDirectory() || !/^java-\d+$/.test(d.name)) continue
      if (ref.javas.has(Number(d.name.slice(5)))) continue
      const dir = path.join(root, 'runtime', d.name)
      const size = dirSize(dir)
      try { fs.rmSync(dir, { recursive: true, force: true }); freed += size } catch {}
    }
  }
  for (const sub of ['libraries', path.join('assets', 'objects'), 'natives']) {
    for (const e of list(path.join(root, sub))) if (e.isDirectory()) removeEmptyDirs(path.join(root, sub, e.name))
  }
  for (const e of list(instancesDir())) {
    if (e.isDirectory() && /^\.tmp-pack-/.test(e.name) && old(path.join(instancesDir(), e.name))) fs.rmSync(path.join(instancesDir(), e.name), { recursive: true, force: true })
  }
  return { freed }
}

module.exports = { scan, clean }
