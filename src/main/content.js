'use strict'
// Моды, ресурспаки и шейдеры: поиск в Modrinth, установка с зависимостями,
// список, вкл/выкл, обновление, удаление.
const fs = require('fs')
const path = require('path')
const { fetchJson, download } = require('./net')
const { normalize, instanceDir, subDir } = require('./profiles')
const { inside } = require('./paths')

const API = 'https://api.modrinth.com/v2'
const TYPES = {
  mod: { folder: 'mods', exts: ['.jar', '.jar.disabled'], loaders: ['fabric'] },
  resourcepack: { folder: 'resourcepacks', exts: ['.zip'], loaders: null },
  shader: { folder: 'shaderpacks', exts: ['.zip'], loaders: ['iris', 'optifine'] }
}
const IRIS_ID = 'YL57xq9U' // Iris Shaders — загрузчик шейдеров для Fabric

function typeInfo (type) {
  const t = TYPES[type]
  if (!t) throw new Error('Неизвестный тип контента')
  return t
}

// ---------- метаданные установленного ----------
function metaFile (profile) {
  return path.join(instanceDir(profile, true), '.astra', 'content.json')
}

function readMeta (profile) {
  try {
    const m = JSON.parse(fs.readFileSync(metaFile(profile), 'utf8'))
    return { mod: m.mod || {}, resourcepack: m.resourcepack || {}, shader: m.shader || {} }
  } catch {
    return { mod: {}, resourcepack: {}, shader: {} }
  }
}

function writeMeta (profile, meta) {
  const file = metaFile(profile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(meta, null, 2))
}

// Ключ метаданных — имя файла без ".disabled", чтобы вкл/выкл не терял данные.
const baseName = f => f.replace(/\.disabled$/, '')

// ---------- поиск ----------
async function search ({ type = 'mod', query = '', gameVersion, loader, sort = 'downloads', offset = 0, limit = 20 } = {}) {
  typeInfo(type)
  const facets = [[`project_type:${type}`]]
  // Лаунчер ставит моды только под Fabric.
  if (type === 'mod') facets.push(['categories:fabric'])
  // Шейдеры для Iris (большинство шейдеров OptiFine тоже работают в Iris).
  if (type === 'shader') facets.push(['categories:iris', 'categories:optifine'])
  // У шейдеров версии игры часто не указаны — по ним не фильтруем.
  if (gameVersion && type !== 'shader') facets.push([`versions:${gameVersion}`])
  const params = new URLSearchParams({
    query: String(query).slice(0, 100),
    facets: JSON.stringify(facets),
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
      categories: (h.display_categories || h.categories || []).filter(c => c !== 'fabric' && c !== 'minecraft'),
      color: h.color || null,
      gallery: h.featured_gallery || (h.gallery && h.gallery[0]) || null
    }))
  }
}

// ---------- установка ----------
function pickVersion (list) {
  if (!Array.isArray(list) || !list.length) return null
  const sorted = [...list].sort((a, b) => new Date(b.date_published) - new Date(a.date_published))
  return sorted.find(v => v.version_type === 'release') || sorted[0]
}

function safeFileName (name, type) {
  const base = path.basename(String(name))
  if (base !== name || base.startsWith('.')) throw new Error('Подозрительное имя файла: ' + name)
  const ok = type === 'mod' ? base.endsWith('.jar') : base.endsWith('.zip')
  if (!ok) throw new Error('Неожиданный тип файла: ' + base)
  return base
}

// Самая новая подходящая версия проекта для этой сборки.
async function latestVersion (projectId, profile, type) {
  const info = typeInfo(type)
  const params = new URLSearchParams({ game_versions: JSON.stringify([profile.version]) })
  if (info.loaders) params.set('loaders', JSON.stringify(info.loaders))
  let list = await fetchJson(`${API}/project/${projectId}/version?${params}`)
  if ((!list || !list.length) && type === 'shader') {
    // Шейдеры часто не помечают новые версии игры — берём последнюю для Iris.
    list = await fetchJson(`${API}/project/${projectId}/version?${new URLSearchParams({ loaders: JSON.stringify(info.loaders) })}`)
  }
  return pickVersion(list)
}

// ctx.onReplace(путь) — что сделать со старым файлом при замене (по умолчанию удалить).
async function install ({ projectId, profile, type = 'mod' }, onStatus = () => {}, visited = new Set(), ctx = {}) {
  profile = normalize(profile)
  const info = typeInfo(type)
  if (type === 'mod' && profile.loader !== 'fabric') throw new Error('Для модов нужна версия с Fabric')
  if (type === 'shader' && profile.loader !== 'fabric') throw new Error('Для шейдеров нужна версия с Fabric')
  if (!/^[A-Za-z0-9]{6,12}$/.test(String(projectId))) throw new Error('Некорректный проект')
  if (visited.has(projectId)) return { installed: [], warnings: [] }
  visited.add(projectId)

  const project = await fetchJson(`${API}/project/${projectId}`)
  const version = await latestVersion(projectId, profile, type)
  if (!version) throw new Error(`«${project.title}» нет для ${profile.version}`)

  const file = version.files.find(f => f.primary) || version.files[0]
  if (!file) throw new Error(`У «${project.title}» нет файла для скачивания`)
  const fileName = safeFileName(file.filename, type)

  const dir = subDir(profile, info.folder, true)

  // Новый файл с тем же именем перезапишет старый — для отката сохраняем копию.
  if (ctx.onReplace && fs.existsSync(inside(dir, fileName))) ctx.onReplace(inside(dir, fileName), { copy: true })
  onStatus({ stage: `Скачиваю ${project.title}` })
  await download(file.url, inside(dir, fileName), {
    group: 'mods',
    hash: file.hashes && file.hashes.sha512 ? { algo: 'sha512', value: file.hashes.sha512 } : null,
    onProgress: (cur, total) => onStatus({ stage: `Скачиваю ${project.title}`, current: cur, total })
  })
  if (ctx.added) ctx.added.add(fileName)
  const disabledTwin = path.join(dir, fileName + '.disabled')
  if (ctx.onReplace && fs.existsSync(disabledTwin)) ctx.onReplace(disabledTwin)
  else fs.rmSync(disabledTwin, { force: true })

  // Старую версию этого же мода удаляем только после того, как новая скачалась.
  const meta = readMeta(profile)
  for (const [fname, m] of Object.entries(meta[type])) {
    if (m.projectId === projectId && fname !== fileName) {
      for (const f of [fname, fname + '.disabled']) {
        const full = path.join(dir, f)
        if (ctx.onReplace && fs.existsSync(full)) ctx.onReplace(full)
        else fs.rmSync(full, { force: true })
      }
      delete meta[type][fname]
    }
  }
  meta[type][fileName] = {
    projectId,
    title: project.title,
    icon: project.icon_url || null,
    description: project.description || '',
    version: version.version_number,
    versionId: version.id,
    installedAt: Date.now()
  }
  writeMeta(profile, meta)

  const result = { installed: [project.title], warnings: [] }

  // Шейдерам нужен Iris (он сам подтянет Sodium).
  if (type === 'shader' && !installedIds({ profile, type: 'mod' }).includes(IRIS_ID)) {
    try {
      const sub = await install({ projectId: IRIS_ID, profile, type: 'mod' }, onStatus, visited, ctx)
      result.installed.push(...sub.installed)
      result.warnings.push(...sub.warnings)
    } catch (e) {
      result.warnings.push(`Не удалось поставить Iris — без него шейдеры не заработают: ${e.message}`)
    }
  }

  // Обязательные зависимости (например, Fabric API).
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required') continue
    try {
      let depId = dep.project_id
      // Иногда Modrinth указывает только конкретную версию зависимости.
      if (!depId && dep.version_id && /^[A-Za-z0-9]{6,12}$/.test(dep.version_id)) {
        depId = (await fetchJson(`${API}/version/${dep.version_id}`)).project_id
      }
      if (!depId || installedIds({ profile, type }).includes(depId)) continue
      const sub = await install({ projectId: depId, profile, type }, onStatus, visited, ctx)
      result.installed.push(...sub.installed)
      result.warnings.push(...sub.warnings)
    } catch (e) {
      result.warnings.push(`Не удалось поставить зависимость: ${e.message}`)
    }
  }
  return result
}

// ---------- установленное ----------
function list ({ profile, type = 'mod' }) {
  profile = normalize(profile)
  const info = typeInfo(type)
  const dir = subDir(profile, info.folder)
  if (!fs.existsSync(dir)) return []
  const meta = readMeta(profile)[type]
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => (e.isFile() && info.exts.some(x => e.name.endsWith(x))) || (type === 'resourcepack' && e.isDirectory()))
    .map(e => {
      const key = baseName(e.name)
      const m = meta[key] || {}
      let size = 0
      try { size = fs.statSync(path.join(dir, e.name)).size } catch {}
      return {
        file: e.name,
        enabled: !e.name.endsWith('.disabled'),
        title: m.title || key.replace(/\.(jar|zip)$/, ''),
        icon: m.icon || null,
        description: m.description || '',
        version: m.version || '',
        projectId: m.projectId || null,
        folder: e.isDirectory(),
        size
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

function toggle ({ profile, file }) {
  profile = normalize(profile)
  const dir = subDir(profile, 'mods')
  const src = inside(dir, path.basename(String(file)))
  if (!fs.existsSync(src)) throw new Error('Файл не найден')
  const dst = src.endsWith('.disabled') ? src.slice(0, -'.disabled'.length) : src + '.disabled'
  fs.renameSync(src, dst)
  return path.basename(dst)
}

function remove ({ profile, type = 'mod', file }) {
  profile = normalize(profile)
  const info = typeInfo(type)
  const name = path.basename(String(file))
  const target = inside(subDir(profile, info.folder), name)
  fs.rmSync(target, { recursive: true, force: true })
  const meta = readMeta(profile)
  delete meta[type][baseName(name)]
  writeMeta(profile, meta)
  return true
}

function installedIds ({ profile, type = 'mod' }) {
  profile = normalize(profile)
  const dir = subDir(profile, typeInfo(type).folder)
  // Учитываем только то, что реально лежит в папке (файл могли удалить руками).
  return Object.entries(readMeta(profile)[type])
    .filter(([f]) => fs.existsSync(path.join(dir, f)) || fs.existsSync(path.join(dir, f + '.disabled')))
    .map(([, m]) => m.projectId)
    .filter(Boolean)
}

// ---------- обновления ----------
// Для каждого установленного проекта ищем самую новую подходящую версию.
async function checkUpdates ({ profile, type = 'mod' }) {
  profile = normalize(profile)
  typeInfo(type)
  const dir = subDir(profile, typeInfo(type).folder)
  const meta = readMeta(profile)[type]
  const items = Object.entries(meta)
    .filter(([f, m]) => m.projectId && (fs.existsSync(path.join(dir, f)) || fs.existsSync(path.join(dir, f + '.disabled'))))
  const updates = []
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const [file, m] = items[i++]
      try {
        const v = await latestVersion(m.projectId, profile, type)
        if (!v) continue
        const newFile = (v.files.find(f => f.primary) || v.files[0] || {}).filename
        const same = m.versionId ? m.versionId === v.id : (newFile === file || m.version === v.version_number)
        if (!same) updates.push({ file, projectId: m.projectId, title: m.title, current: m.version || '', latest: v.version_number })
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker))
  return updates.sort((a, b) => a.title.localeCompare(b.title))
}

// Обновление одного проекта. Выключенный мод остаётся выключенным.
async function updateOne ({ profile, type = 'mod', file }, onStatus, ctx = {}) {
  profile = normalize(profile)
  const dir = subDir(profile, typeInfo(type).folder)
  const name = path.basename(String(file))
  const m = readMeta(profile)[type][name]
  if (!m || !m.projectId) throw new Error('Неизвестно, откуда этот файл — обнови его вручную')
  const wasDisabled = !fs.existsSync(path.join(dir, name)) && fs.existsSync(path.join(dir, name + '.disabled'))
  const res = await install({ projectId: m.projectId, profile, type }, onStatus, new Set(), ctx)
  if (wasDisabled) {
    const now = Object.entries(readMeta(profile)[type]).find(([, x]) => x.projectId === m.projectId)
    if (now && fs.existsSync(path.join(dir, now[0]))) fs.renameSync(path.join(dir, now[0]), path.join(dir, now[0] + '.disabled'))
  }
  return res
}

// Установки идут строго по очереди: иначе две параллельные установки
// перезаписывали бы content.json друг друга и качали бы одну зависимость дважды.
let queue = Promise.resolve()
function installQueued (params, onStatus) {
  const run = queue.then(() => install(params, onStatus))
  queue = run.catch(() => {})
  return run
}

// ---------- откат обновления ----------
// Перед обновлением запоминаем список файлов и content.json, а заменённые файлы
// не удаляем, а складываем в .astra/rollback-<тип>/files. «Вернуть как было»
// убирает всё новое и возвращает старое. Хранится один последний откат на тип.
function rollbackDir (profile, type) {
  return path.join(instanceDir(profile, true), '.astra', `rollback-${type}`)
}

function readRollback (profile, type) {
  try { return JSON.parse(fs.readFileSync(path.join(rollbackDir(profile, type), 'rollback.json'), 'utf8')) } catch { return null }
}

function rollbackInfo ({ profile, type = 'mod' }) {
  profile = normalize(profile)
  typeInfo(type)
  const r = readRollback(profile, type)
  return r ? { createdAt: r.createdAt, titles: r.titles || [], confirmed: !!r.confirmed } : null
}

// Обновление сразу нескольких файлов одним снимком для отката.
async function updateMany ({ profile, type = 'mod', files = [] }, onStatus = () => {}) {
  profile = normalize(profile)
  const info = typeInfo(type)
  const dir = subDir(profile, info.folder, true)
  const rdir = rollbackDir(profile, type)
  // Новый снимок собираем рядом и заменяем им старый, только если что-то обновилось:
  // неудачная попытка не должна стирать прошлую точку отката.
  const tdir = rdir + '.new'
  fs.rmSync(tdir, { recursive: true, force: true })
  fs.mkdirSync(path.join(tdir, 'files'), { recursive: true })
  const metaBefore = readMeta(profile)
  const saved = []
  const added = new Set() // только файлы, которые записала эта установка
  const ctx = {
    added,
    onReplace (full, { copy = false } = {}) {
      const name = path.basename(full)
      if (saved.includes(name)) return
      if (copy) fs.copyFileSync(full, path.join(tdir, 'files', name))
      else fs.renameSync(full, path.join(tdir, 'files', name))
      saved.push(name)
    }
  }
  const done = []
  const errors = []
  const titles = []
  for (const file of files) {
    const m = metaBefore[type][path.basename(String(file))]
    try {
      await updateOne({ profile, type, file }, onStatus, ctx)
      done.push(file)
      if (m && m.title) titles.push(m.title)
    } catch (e) {
      errors.push({ file, title: (m && m.title) || file, error: e.message })
    }
  }
  if (done.length) {
    // Файл, который был и до обновления (то же имя), не «новый» — его вернёт копия из saved.
    const fresh = [...added].filter(f => !saved.includes(f) && !saved.includes(f + '.disabled'))
    const savedMeta = {}
    for (const f of saved) { const k = baseName(f); if (metaBefore[type][k]) savedMeta[k] = metaBefore[type][k] }
    fs.writeFileSync(path.join(tdir, 'rollback.json'), JSON.stringify({ createdAt: Date.now(), type, added: fresh, saved, meta: savedMeta, titles, confirmed: false }, null, 2))
    fs.rmSync(rdir, { recursive: true, force: true })
    fs.renameSync(tdir, rdir)
  } else {
    // Ничего не обновилось: всё, что успели убрать, возвращаем на место.
    for (const name of saved) {
      const src = path.join(tdir, 'files', name)
      if (fs.existsSync(src) && !fs.existsSync(path.join(dir, name))) fs.renameSync(src, path.join(dir, name))
    }
    fs.rmSync(tdir, { recursive: true, force: true })
  }
  return { updated: done.length, errors, titles }
}

function rollback ({ profile, type = 'mod' }) {
  profile = normalize(profile)
  const info = typeInfo(type)
  const r = readRollback(profile, type)
  if (!r) throw new Error('Откатывать нечего')
  const dir = subDir(profile, info.folder, true)
  const rdir = rollbackDir(profile, type)
  const meta = readMeta(profile)
  // Файлы, которые появились при обновлении, убираем (вместе с .disabled-вариантом)…
  for (const f of r.added || []) {
    const name = baseName(path.basename(f))
    for (const x of [name, name + '.disabled']) fs.rmSync(inside(dir, x), { force: true })
    delete meta[type][name]
  }
  // …и возвращаем заменённые.
  for (const f of r.saved || []) {
    const name = path.basename(f)
    const src = path.join(rdir, 'files', name)
    if (fs.existsSync(src)) fs.renameSync(src, inside(dir, name))
  }
  Object.assign(meta[type], r.meta || {})
  writeMeta(profile, meta)
  fs.rmSync(rdir, { recursive: true, force: true })
  return { titles: r.titles || [] }
}

// Игра после обновления нормально отработала — кнопку отката в окне вылета больше не предлагаем.
function confirmRollback (profile) {
  try {
    profile = normalize(profile)
    for (const type of Object.keys(TYPES)) {
      const file = path.join(rollbackDir(profile, type), 'rollback.json')
      const r = readRollback(profile, type)
      if (r && !r.confirmed) { r.confirmed = true; fs.writeFileSync(file, JSON.stringify(r, null, 2)) }
    }
  } catch {}
}

// ---------- установка в отдельную папку ----------
// Для «Играть с другом» в обычной версии: мод и его обязательные зависимости
// кладутся в свою папку и подключаются к игре через -Dfabric.addMods.
async function installInto (dir, projectId, gameVersion, onStatus = () => {}, seen = new Set()) {
  if (!/^[A-Za-z0-9]{6,12}$/.test(String(projectId)) || seen.has(projectId)) return []
  seen.add(projectId)
  fs.mkdirSync(dir, { recursive: true })
  const metaFile = path.join(dir, 'astra-mods.json')
  let meta = {}
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) } catch {}
  const version = await latestVersion(projectId, { version: gameVersion }, 'mod')
  if (!version) return null
  const file = version.files.find(f => f.primary) || version.files[0]
  const fileName = safeFileName(file.filename, 'mod')
  const target = inside(dir, fileName)
  if (!(meta[projectId] && meta[projectId].file === fileName && fs.existsSync(target))) {
    onStatus({ stage: `Скачиваю ${fileName}` })
    await download(file.url, target, { group: 'game', hash: file.hashes && file.hashes.sha512 ? { algo: 'sha512', value: file.hashes.sha512 } : null })
    if (meta[projectId] && meta[projectId].file !== fileName) fs.rmSync(path.join(dir, path.basename(meta[projectId].file)), { force: true })
    meta[projectId] = { file: fileName, versionId: version.id }
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2))
  }
  const out = [fileName]
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id) continue
    const sub = await installInto(dir, dep.project_id, gameVersion, onStatus, seen)
    if (sub) out.push(...sub)
  }
  return out
}

function updateQueued (params, onStatus) {
  const run = queue.then(() => updateOne(params, onStatus))
  queue = run.catch(() => {})
  return run
}

function updateManyQueued (params, onStatus) {
  const run = queue.then(() => updateMany(params, onStatus))
  queue = run.catch(() => {})
  return run
}

module.exports = {
  search, install: installQueued, update: updateQueued, updateMany: updateManyQueued, checkUpdates, list, toggle, remove, installedIds,
  rollbackInfo, rollback, confirmRollback, installInto, latestVersion, readMeta, TYPES
}
