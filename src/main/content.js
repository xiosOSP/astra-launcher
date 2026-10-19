'use strict'
// Моды и ресурспаки: поиск в Modrinth, установка с зависимостями, список, вкл/выкл, удаление.
const fs = require('fs')
const path = require('path')
const { fetchJson, download } = require('./net')
const { normalize, instanceDir, subDir } = require('./profiles')
const { inside } = require('./paths')

const API = 'https://api.modrinth.com/v2'
const TYPES = {
  mod: { folder: 'mods', exts: ['.jar', '.jar.disabled'] },
  resourcepack: { folder: 'resourcepacks', exts: ['.zip'] }
}

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
    return { mod: m.mod || {}, resourcepack: m.resourcepack || {} }
  } catch {
    return { mod: {}, resourcepack: {} }
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
  if (gameVersion) facets.push([`versions:${gameVersion}`])
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

async function install ({ projectId, profile, type = 'mod' }, onStatus = () => {}, visited = new Set()) {
  profile = normalize(profile)
  const info = typeInfo(type)
  if (type === 'mod' && profile.loader !== 'fabric') throw new Error('Для модов нужна версия с Fabric')
  if (!/^[A-Za-z0-9]{6,12}$/.test(String(projectId))) throw new Error('Некорректный проект')
  if (visited.has(projectId)) return { installed: [], warnings: [] }
  visited.add(projectId)

  const project = await fetchJson(`${API}/project/${projectId}`)
  const params = new URLSearchParams({ game_versions: JSON.stringify([profile.version]) })
  if (type === 'mod') params.set('loaders', JSON.stringify(['fabric']))
  const version = pickVersion(await fetchJson(`${API}/project/${projectId}/version?${params}`))
  if (!version) throw new Error(`«${project.title}» нет для ${profile.version}`)

  const file = version.files.find(f => f.primary) || version.files[0]
  if (!file) throw new Error(`У «${project.title}» нет файла для скачивания`)
  const fileName = safeFileName(file.filename, type)

  const dir = subDir(profile, info.folder, true)

  onStatus({ stage: `Скачиваю ${project.title}` })
  await download(file.url, inside(dir, fileName), {
    group: 'mods',
    hash: file.hashes && file.hashes.sha512 ? { algo: 'sha512', value: file.hashes.sha512 } : null,
    onProgress: (cur, total) => onStatus({ stage: `Скачиваю ${project.title}`, current: cur, total })
  })
  fs.rmSync(path.join(dir, fileName + '.disabled'), { force: true })

  // Старую версию этого же мода удаляем только после того, как новая скачалась.
  const meta = readMeta(profile)
  for (const [fname, m] of Object.entries(meta[type])) {
    if (m.projectId === projectId && fname !== fileName) {
      for (const f of [fname, fname + '.disabled']) fs.rmSync(path.join(dir, f), { force: true })
      delete meta[type][fname]
    }
  }
  meta[type][fileName] = {
    projectId,
    title: project.title,
    icon: project.icon_url || null,
    description: project.description || '',
    version: version.version_number,
    installedAt: Date.now()
  }
  writeMeta(profile, meta)

  const result = { installed: [project.title], warnings: [] }

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
      const sub = await install({ projectId: depId, profile, type }, onStatus, visited)
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

// Установки идут строго по очереди: иначе две параллельные установки
// перезаписывали бы content.json друг друга и качали бы одну зависимость дважды.
let queue = Promise.resolve()
function installQueued (params, onStatus) {
  const run = queue.then(() => install(params, onStatus))
  queue = run.catch(() => {})
  return run
}

module.exports = { search, install: installQueued, list, toggle, remove, installedIds }
