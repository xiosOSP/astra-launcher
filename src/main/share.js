'use strict'
// «Поделиться сборкой»: сохраняет версию, моды, ресурспаки, шейдеры и настройки модов
// в один файл .mrpack (формат Modrinth). Файлы, которые есть на Modrinth, в архив
// не кладутся — только ссылка и хеш, поэтому файл получается маленьким.
// Остальное (свои моды, конфиги) кладётся внутрь, в папку overrides.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const yazl = require('yazl')
const { postJson } = require('./net')
const versions = require('./versions')
const modpacks = require('./modpacks')
const { normalize, instanceDir } = require('./profiles')

const API = 'https://api.modrinth.com/v2'
const FOLDERS = [['mods', /\.jar$/i], ['resourcepacks', /\.zip$/i], ['shaderpacks', /\.zip$/i]]
const MAX_OVERRIDE = 50 * 1024 * 1024 // один файл внутри архива — не больше 50 МБ

function hashFile (file) {
  return new Promise((resolve, reject) => {
    const a = crypto.createHash('sha1'); const b = crypto.createHash('sha512')
    let size = 0
    fs.createReadStream(file)
      .on('data', d => { a.update(d); b.update(d); size += d.length })
      .on('end', () => resolve({ sha1: a.digest('hex'), sha512: b.digest('hex'), size }))
      .on('error', reject)
  })
}

function walk (dir, base = dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, base, out)
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

function loaderVersionFor (profile) {
  if (profile.pack) {
    const m = modpacks.readPackMeta(profile.pack)
    if (m && m.loaderVersion) return m.loaderVersion
  }
  if (profile.loader !== 'fabric') return null
  // Профиль Fabric называется fabric-loader-<загрузчик>-<версия игры>.
  const id = versions.fabricProfilesFor(profile.version).sort().pop() || ''
  const tail = `-${profile.version}`
  return id.startsWith('fabric-loader-') && id.endsWith(tail) ? id.slice('fabric-loader-'.length, -tail.length) || null : null
}

async function exportPack (rawProfile, dest, { name } = {}) {
  const profile = normalize(rawProfile)
  const inst = instanceDir(profile)
  if (!fs.existsSync(inst)) throw new Error('Эту версию ещё ни разу не запускали — делиться пока нечем')

  // 1. Файлы и их хеши (выключенные моды не берём).
  const files = []
  for (const [folder, re] of FOLDERS) {
    let list = []
    try { list = fs.readdirSync(path.join(inst, folder)).filter(f => re.test(f)) } catch {}
    for (const f of list) {
      const abs = path.join(inst, folder, f)
      if (!fs.statSync(abs).isFile()) continue
      files.push({ rel: `${folder}/${f}`, abs, ...(await hashFile(abs)) })
    }
  }

  // 2. Что из этого есть на Modrinth.
  const known = {}
  if (files.length) {
    try {
      const res = await postJson(`${API}/version_files`, { hashes: files.map(f => f.sha1), algorithm: 'sha1' }, { timeout: 15000 })
      if (res.ok && res.data) Object.assign(known, res.data)
    } catch {}
  }

  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0',
    name: String(name || `Сборка ${profile.version}`).slice(0, 80),
    summary: 'Сделано в AstraLauncher',
    files: [],
    dependencies: { minecraft: profile.version }
  }
  const loader = loaderVersionFor(profile)
  if (loader) index.dependencies['fabric-loader'] = loader
  // Сборки в лаунчере запускаются через Fabric — у друга без него версия не запустится.
  if (!loader && !(await versions.getFabricGames()).has(profile.version)) {
    throw new Error(`Поделиться можно только версией, которую поддерживает Fabric, а ${profile.version} он не поддерживает`)
  }

  const zip = new yazl.ZipFile()
  let fromModrinth = 0
  let inside = 0
  const skipped = []
  for (const f of files) {
    const v = known[f.sha1]
    const vf = v && (v.files || []).find(x => x.hashes && x.hashes.sha1 === f.sha1)
    if (vf && /^https:\/\/cdn\.modrinth\.com\//.test(vf.url)) {
      index.files.push({ path: f.rel, hashes: { sha1: f.sha1, sha512: f.sha512 }, downloads: [vf.url], fileSize: f.size })
      fromModrinth++
    } else if (f.size <= MAX_OVERRIDE) {
      zip.addFile(f.abs, `overrides/${f.rel}`)
      inside++
    } else {
      skipped.push(f.rel)
    }
  }
  // 3. Настройки модов.
  for (const rel of walk(path.join(inst, 'config'))) {
    const abs = path.join(inst, 'config', ...rel.split('/'))
    if (fs.statSync(abs).size <= MAX_OVERRIDE) zip.addFile(abs, `overrides/config/${rel}`)
  }
  zip.addBuffer(Buffer.from(JSON.stringify(index, null, 2)), 'modrinth.index.json')
  zip.end()

  const tmp = dest + '.part'
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp)
    zip.outputStream.pipe(out)
    zip.outputStream.on('error', reject)
    out.on('error', reject)
    out.on('close', resolve)
  })
  fs.renameSync(tmp, dest)
  return { file: dest, fromModrinth, inside, skipped, size: fs.statSync(dest).size }
}

module.exports = { exportPack }
