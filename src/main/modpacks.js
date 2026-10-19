'use strict'
// Сборки модов из Modrinth (формат .mrpack). Каждая сборка живёт в своей папке
// instances/pack-<id>: моды, настройки, миры. Версию игры и загрузчика берём из сборки.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { fetchJson, download } = require('./net')
const { instancesDir, PACK_RE } = require('./profiles')
const { inside } = require('./paths')
const { Progress } = require('./progress')

const API = 'https://api.modrinth.com/v2'
// Откуда сборкам Modrinth разрешено скачивать файлы (правила самого Modrinth).
const FILE_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'])

function packDir (id) {
  if (!PACK_RE.test(String(id))) throw new Error('Некорректная сборка')
  return inside(instancesDir(), `pack-${id}`)
}

function metaFile (id) {
  return path.join(packDir(id), '.astra', 'pack.json')
}

function readPackMeta (id) {
  try { return JSON.parse(fs.readFileSync(metaFile(id), 'utf8')) } catch { return null }
}

function sha1File (file) {
  return new Promise(resolve => {
    const h = crypto.createHash('sha1')
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(null))
  })
}

function pickVersion (list) {
  if (!Array.isArray(list) || !list.length) return null
  const sorted = [...list].sort((a, b) => new Date(b.date_published) - new Date(a.date_published))
  return sorted.find(v => v.version_type === 'release') || sorted[0]
}

// ---------- каталог ----------
async function search ({ query = '', sort = 'downloads', offset = 0, limit = 20 } = {}) {
  const params = new URLSearchParams({
    query: String(query).slice(0, 100),
    facets: JSON.stringify([['project_type:modpack'], ['categories:fabric']]),
    index: ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'downloads',
    offset: String(Math.max(0, Number(offset) || 0)),
    limit: String(Math.min(50, Math.max(1, Number(limit) || 20)))
  })
  const res = await fetchJson(`${API}/search?${params}`)
  return {
    total: res.total_hits || 0,
    hits: (res.hits || []).map(h => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url || null,
      downloads: h.downloads || 0,
      follows: h.follows || 0,
      categories: (h.display_categories || []).filter(c => c !== 'fabric'),
      versions: h.versions || [],
      color: h.color || null
    }))
  }
}

// ---------- установленные ----------
function list () {
  const base = instancesDir()
  if (!fs.existsSync(base)) return []
  return fs.readdirSync(base)
    .filter(d => /^pack-[A-Za-z0-9]{6,12}$/.test(d))
    .map(d => readPackMeta(d.slice(5)))
    .filter(Boolean)
    .map(m => {
      let mods = 0
      try { mods = fs.readdirSync(path.join(packDir(m.id), 'mods')).filter(f => f.endsWith('.jar')).length } catch {}
      return { id: m.id, local: !!m.local, name: m.name, icon: m.icon, description: m.description, mcVersion: m.mcVersion, loaderVersion: m.loaderVersion, versionNumber: m.versionNumber, versionId: m.versionId, slug: m.slug, installedAt: m.installedAt, mods }
    })
    .sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))
}

async function checkUpdate (id) {
  const m = readPackMeta(id)
  if (!m) throw new Error('Сборка не найдена')
  if (m.local) return { available: false, local: true }
  const v = pickVersion(await fetchJson(`${API}/project/${id}/version?${new URLSearchParams({ loaders: JSON.stringify(['fabric']) })}`))
  return v && v.id !== m.versionId ? { available: true, versionNumber: v.version_number, mcVersion: (v.game_versions || [])[0] } : { available: false }
}

function remove (id) {
  fs.rmSync(packDir(id), { recursive: true, force: true })
  return true
}

// Копирует папку overrides в папку сборки. На обновлении не трогаем настройки игрока.
function copyOverrides (src, dest, { keepUserFiles }) {
  if (!fs.existsSync(src)) return []
  const copied = []
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop()
    for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = rel ? path.join(rel, e.name) : e.name
      const target = inside(dest, r)
      if (e.isDirectory()) { fs.mkdirSync(target, { recursive: true }); stack.push(r); continue }
      if (keepUserFiles && r === 'options.txt' && fs.existsSync(target)) continue
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(src, r), target)
      copied.push(r.split(path.sep).join('/'))
    }
  }
  return copied
}

// Разбор и установка файла .mrpack в папку сборки id.
// source: { project, version } для сборок из Modrinth или { local: true } для файла с диска.
async function applyMrpack (id, mrpack, work, progress, source) {
  const dir = packDir(id)
  const old = readPackMeta(id)
  const unpacked = path.join(work, 'x')
  await require('extract-zip')(mrpack, { dir: path.resolve(unpacked) })
  let index
  try { index = JSON.parse(fs.readFileSync(path.join(unpacked, 'modrinth.index.json'), 'utf8')) } catch { throw new Error('Файл сборки повреждён: нет modrinth.index.json') }
  const deps = index.dependencies || {}
  if (index.game !== 'minecraft' || !deps.minecraft) throw new Error('Это не сборка для Minecraft')
  if (!/^[\w.+-]{1,40}$/.test(String(deps.minecraft))) throw new Error('В сборке странная версия игры')
  const other = ['forge', 'neoforge', 'quilt-loader'].find(k => deps[k])
  if (other) throw new Error(`Сборка сделана под ${other === 'quilt-loader' ? 'Quilt' : other === 'neoforge' ? 'NeoForge' : 'Forge'} — такие лаунчер пока не ставит`)

  try {
    // 1. Файлы модов: проверяем путь, адрес и хеш каждого
    fs.mkdirSync(dir, { recursive: true })
    const jobs = []
    for (const f of index.files || []) {
      if (f.env && f.env.client === 'unsupported') continue
      const rel = String(f.path || '').replace(/\\/g, '/')
      if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new Error('Сборка содержит подозрительный путь: ' + rel)
      const url = (f.downloads || []).find(u => { try { const x = new URL(u); return x.protocol === 'https:' && FILE_HOSTS.has(x.hostname) } catch { return false } })
      if (!url) throw new Error('Сборка просит скачать файл с неразрешённого сайта: ' + rel)
      const hash = f.hashes && f.hashes.sha512 ? { algo: 'sha512', value: f.hashes.sha512 } : f.hashes && f.hashes.sha1 ? { algo: 'sha1', value: f.hashes.sha1 } : null
      if (!hash) throw new Error('У файла сборки нет контрольной суммы: ' + rel)
      jobs.push({ rel, url, hash, sha1: f.hashes && f.hashes.sha1, size: f.fileSize || 0, target: inside(dir, rel) })
    }

    // Уже скачанное (при обновлении) не качаем заново.
    progress.range(0, 8)
    progress.countStart(jobs.length, 'Проверяю файлы сборки')
    const todo = []
    for (const j of jobs) {
      const have = fs.existsSync(j.target) && j.sha1 && (await sha1File(j.target)) === j.sha1
      if (!have) todo.push(j)
      progress.countTick()
    }
    progress.range(8, 92)
    const total = todo.reduce((n, j) => n + (j.size || 300 * 1024), 0)
    progress.bytesStart(total, `Скачиваю моды сборки (${todo.length})`)
    let next = 0
    let failed = null
    const worker = async () => {
      while (!failed && next < todo.length) {
        const j = todo[next++]
        const expected = j.size || 300 * 1024
        for (let attempt = 1; ; attempt++) {
          try {
            await download(j.url, j.target, { group: 'mods', hash: j.hash, onProgress: cur => progress.partial(j, Math.min(cur, expected)) })
            progress.fileDone(j, expected)
            break
          } catch (e) {
            progress.fileRetry(j)
            if (attempt >= 3) throw e
            await new Promise(r => setTimeout(r, 600 * attempt))
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, todo.length) }, async () => {
      try { await worker() } catch (e) { if (!failed) failed = e }
    }))
    if (failed) throw failed

    // 2. Убираем файлы старой версии сборки, которых нет в новой.
    const newSet = new Set(jobs.map(j => j.rel))
    if (old && Array.isArray(old.files)) {
      for (const rel of old.files) {
        if (newSet.has(rel)) continue
        try { fs.rmSync(inside(dir, rel), { force: true }) } catch {}
      }
    }

    // 3. Настройки и конфиги сборки
    progress.setStage('Копирую настройки сборки', true)
    const keep = !!old
    copyOverrides(path.join(unpacked, 'overrides'), dir, { keepUserFiles: keep })
    copyOverrides(path.join(unpacked, 'client-overrides'), dir, { keepUserFiles: keep })

    const { project = {}, version = {} } = source
    const meta = {
      id,
      local: !!source.local,
      slug: project.slug || null,
      name: String(index.name || project.title || 'Сборка').slice(0, 80),
      icon: project.icon_url || null,
      description: String(project.description || index.summary || '').slice(0, 300),
      mcVersion: deps.minecraft,
      loaderVersion: deps['fabric-loader'] || null,
      versionId: version.id || null,
      versionNumber: String(version.version_number || index.versionId || '1.0').slice(0, 40),
      files: [...newSet],
      installedAt: old ? old.installedAt : Date.now(),
      updatedAt: Date.now()
    }
    fs.mkdirSync(path.dirname(metaFile(id)), { recursive: true })
    fs.writeFileSync(metaFile(id), JSON.stringify(meta, null, 2))
    progress.complete(old ? 'Сборка обновлена' : 'Сборка установлена')
    return { profile: { version: deps.minecraft, loader: 'fabric', pack: id }, name: meta.name, updated: !!old }
  } catch (e) {
    // Новая установка не удалась — не оставляем полупустую папку.
    if (!old) fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

/**
 * Установка или обновление сборки из Modrinth. onStatus({ stage, percent, detail }).
 * Возвращает профиль { version, loader: 'fabric', pack }.
 */
async function install (projectId, onStatus = () => {}) {
  if (!PACK_RE.test(String(projectId))) throw new Error('Некорректная сборка')
  const progress = new Progress(onStatus)
  progress.setStage('Готовлю сборку')

  const project = await fetchJson(`${API}/project/${projectId}`)
  const version = pickVersion(await fetchJson(`${API}/project/${projectId}/version?${new URLSearchParams({ loaders: JSON.stringify(['fabric']) })}`))
  if (!version) throw new Error(`У «${project.title}» нет версии для Fabric`)
  const file = version.files.find(f => f.primary) || version.files[0]
  if (!file || !file.filename.endsWith('.mrpack')) throw new Error('В сборке нет файла .mrpack')

  const work = path.join(instancesDir(), `.tmp-pack-${projectId}`)
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  try {
    const mrpack = path.join(work, 'pack.mrpack')
    await download(file.url, mrpack, {
      group: 'mods',
      hash: file.hashes && file.hashes.sha512 ? { algo: 'sha512', value: file.hashes.sha512 } : null
    })
    return await applyMrpack(projectId, mrpack, work, progress, { project, version })
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

// Сборка из файла .mrpack (например, от друга). Получает свой id вида L + 9 символов.
async function importFile (file, onStatus = () => {}) {
  const src = path.resolve(String(file))
  if (!/\.mrpack$/i.test(src) || !fs.existsSync(src)) throw new Error('Нужен файл сборки .mrpack')
  if (fs.statSync(src).size > 1024 ** 3) throw new Error('Файл сборки слишком большой')
  const progress = new Progress(onStatus)
  progress.setStage('Открываю файл сборки')
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id
  do { id = 'L' + Array.from(crypto.randomBytes(9), b => abc[b % abc.length]).join('') } while (fs.existsSync(packDir(id)))
  const work = path.join(instancesDir(), `.tmp-pack-${id}`)
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  try {
    const copy = path.join(work, 'pack.mrpack')
    fs.copyFileSync(src, copy)
    return await applyMrpack(id, copy, work, progress, { local: true })
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

let queue = Promise.resolve()
function installQueued (id, onStatus) {
  const run = queue.then(() => install(id, onStatus))
  queue = run.catch(() => {})
  return run
}

function importQueued (file, onStatus) {
  const run = queue.then(() => importFile(file, onStatus))
  queue = run.catch(() => {})
  return run
}

module.exports = { search, list, install: installQueued, importFile: importQueued, checkUpdate, remove, readPackMeta, packDir }

