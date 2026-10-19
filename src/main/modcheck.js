'use strict'
// Проверка модов перед запуском. Каждый .jar узнаём в Modrinth по хешу
// (POST /v2/version_files) и смотрим, что о нём сказал автор:
//  — мод сделан для Forge/NeoForge, а не для Fabric;
//  — мод несовместим с другим установленным модом;
//  — моду нужен другой мод, а его нет (кроме сборок: там авторы подбирают моды сами);
//  — один и тот же мод стоит дважды.
// Ответы Modrinth по хешам не меняются — кэшируем их на диске.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')
const { postJson, fetchJson } = require('./net')
const { instanceDir } = require('./profiles')
const content = require('./content')

const API = 'https://api.modrinth.com/v2'

function sha1File (file) {
  return new Promise(resolve => {
    const h = crypto.createHash('sha1')
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(null))
  })
}

// Хеши файлов сборки с кэшем по размеру и времени изменения.
async function hashes (dir, files, cacheFile) {
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch {}
  const out = {}
  const next = {}
  for (const f of files) {
    let st
    try { st = fs.statSync(path.join(dir, f)) } catch { continue }
    const c = cache[f]
    const sha1 = c && c.size === st.size && c.mtime === st.mtimeMs ? c.sha1 : await sha1File(path.join(dir, f))
    if (!sha1) continue
    out[f] = sha1
    next[f] = { size: st.size, mtime: st.mtimeMs, sha1 }
  }
  try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(next)) } catch {}
  return out
}

// ---------- кэш ответов Modrinth ----------
let remote = null
function remoteFile () { return path.join(app.getPath('userData'), 'modrinth-cache.json') }
function loadRemote () {
  if (remote) return remote
  try { remote = JSON.parse(fs.readFileSync(remoteFile(), 'utf8')) } catch { remote = {} }
  remote.versions = remote.versions || {}
  remote.projects = remote.projects || {}
  return remote
}
function saveRemote () {
  try {
    // Не даём кэшу расти бесконечно.
    for (const key of ['versions', 'projects']) {
      const ks = Object.keys(remote[key])
      if (ks.length > 4000) for (const k of ks.slice(0, ks.length - 4000)) delete remote[key][k]
    }
    fs.writeFileSync(remoteFile(), JSON.stringify(remote))
  } catch {}
}

// sha1 → { projectId, loaders, deps:[{projectId, type}], gameVersions } или null (не из Modrinth).
async function lookup (sha1s) {
  const r = loadRemote()
  const unknown = sha1s.filter(h => !(h in r.versions))
  if (unknown.length) {
    for (let i = 0; i < unknown.length; i += 200) {
      const part = unknown.slice(i, i + 200)
      const res = await postJson(`${API}/version_files`, { hashes: part, algorithm: 'sha1' }, { timeout: 8000 })
      if (!res.ok) throw new Error('Modrinth не ответил')
      const data = res.data || {}
      for (const h of part) {
        const v = data[h]
        r.versions[h] = v
          ? {
              projectId: v.project_id,
              versionId: v.id,
              loaders: v.loaders || [],
              gameVersions: v.game_versions || [],
              deps: (v.dependencies || []).filter(d => d.project_id).map(d => ({ projectId: d.project_id, type: d.dependency_type }))
            }
          : null
      }
    }
    saveRemote()
  }
  const out = {}
  for (const h of sha1s) out[h] = r.versions[h] || null
  return out
}

async function projectTitles (ids) {
  const r = loadRemote()
  const need = ids.filter(id => !r.projects[id])
  if (need.length) {
    const list = await fetchJson(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(need.slice(0, 100)))}`, { timeout: 8000 })
    for (const p of list || []) r.projects[p.id] = { title: p.title, slug: p.slug }
    saveRemote()
  }
  const out = {}
  for (const id of ids) out[id] = (r.projects[id] && r.projects[id].title) || id
  return out
}

/**
 * Возвращает список предупреждений: { id, title, text, actions:[{ type, file?, projectId?, label }] }.
 * Без сети тихо возвращает пустой список — проверка не должна мешать играть.
 */
async function check (profile) {
  if (profile.loader !== 'fabric') return []
  const inst = instanceDir(profile)
  const dir = path.join(inst, 'mods')
  let files
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jar')) } catch { return [] }
  if (!files.length) return []
  const sums = await hashes(dir, files, path.join(inst, '.astra', 'hashes.json'))
  const info = await lookup([...new Set(Object.values(sums))])

  const byFile = {}
  const byProject = {}
  for (const f of files) {
    const v = info[sums[f]]
    if (!v) continue
    byFile[f] = v
    ;(byProject[v.projectId] = byProject[v.projectId] || []).push(f)
  }
  const meta = content.readMeta(profile).mod
  const ids = new Set(Object.keys(byProject))
  const deps = new Set()
  for (const v of Object.values(byFile)) for (const d of v.deps) if (d.type === 'required' || d.type === 'incompatible') deps.add(d.projectId)
  let titles = {}
  try { titles = await projectTitles([...new Set([...ids, ...deps])]) } catch {}
  const title = (f, pid) => (meta[f] && meta[f].title) || titles[pid] || f

  const warnings = []
  const seen = new Set()
  for (const [f, v] of Object.entries(byFile)) {
    const name = title(f, v.projectId)
    // 1. Не тот загрузчик
    if (v.loaders.length && !v.loaders.includes('fabric')) {
      const what = v.loaders.includes('neoforge') ? 'NeoForge' : v.loaders.includes('forge') ? 'Forge' : v.loaders.includes('quilt') ? 'Quilt' : v.loaders.join(', ')
      warnings.push({
        id: `mods:loader:${v.projectId}`,
        title: `«${name}» — мод для ${what}`,
        text: 'В Fabric он не запустится, и игра вылетит. Его лучше выключить.',
        actions: [{ type: 'disable', file: f, label: `Выключить «${name}»` }]
      })
      continue
    }
    for (const d of v.deps) {
      // 2. Несовместимость
      if (d.type === 'incompatible' && ids.has(d.projectId) && d.projectId !== v.projectId) {
        const key = [v.projectId, d.projectId].sort().join(':')
        if (seen.has(key)) continue
        seen.add(key)
        const other = byProject[d.projectId][0]
        const otherName = title(other, d.projectId)
        warnings.push({
          id: `mods:incompat:${key}`,
          title: `«${name}» и «${otherName}» несовместимы`,
          text: 'Так сказал автор мода. Вместе они, скорее всего, сломают игру — выключи один из них.',
          actions: [{ type: 'disable', file: f, label: `Выключить «${name}»` }, { type: 'disable', file: other, label: `Выключить «${otherName}»` }]
        })
      }
      // 3. Не хватает обязательного мода
      if (d.type === 'required' && !profile.pack && !ids.has(d.projectId)) {
        const key = `mods:missing:${v.projectId}:${d.projectId}`
        if (seen.has(key)) continue
        seen.add(key)
        const need = titles[d.projectId] || 'другой мод'
        warnings.push({
          id: key,
          title: `«${name}» не хватает «${need}»`,
          text: 'Без него мод не запустится. Лаунчер может поставить его сам.',
          actions: [{ type: 'install', projectId: d.projectId, label: `Установить «${need}»` }]
        })
      }
    }
  }
  // 4. Один мод дважды
  for (const [pid, list] of Object.entries(byProject)) {
    if (list.length < 2) continue
    const keep = list.find(f => meta[f]) || list[list.length - 1]
    const extra = list.filter(f => f !== keep)
    warnings.push({
      id: `mods:dup:${pid}`,
      title: `«${title(keep, pid)}» установлен ${list.length} ${list.length < 5 ? 'раза' : 'раз'}`,
      text: `Лишние копии: ${extra.join(', ')}. Из-за этого игра не запустится.`,
      actions: extra.map(f => ({ type: 'disable', file: f, label: `Выключить ${f}` }))
    })
  }
  return warnings
}

module.exports = { check, sha1File }
