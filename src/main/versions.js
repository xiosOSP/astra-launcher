'use strict'
const fs = require('fs')
const path = require('path')
const { fetchJson } = require('./net')
const settings = require('./settings')
const { safeName, inside } = require('./paths')

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FABRIC_GAMES_URL = 'https://meta.fabricmc.net/v2/versions/game'

let manifestMem = null
let manifestAt = 0
let fabricGamesMem = null

const root = () => settings.gameDir()
const versionsDir = () => path.join(root(), 'versions')
const cacheDir = () => path.join(root(), 'cache')

function readJsonSafe (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJson (file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data))
}

// Манифест кешируется на диск: без интернета можно играть в уже скачанные версии.
async function getManifest (force = false) {
  if (!force && manifestMem && Date.now() - manifestAt < 10 * 60 * 1000) return manifestMem
  const file = path.join(cacheDir(), 'version_manifest_v2.json')
  try {
    manifestMem = await fetchJson(MANIFEST_URL)
    manifestAt = Date.now()
    writeJson(file, manifestMem)
  } catch (e) {
    const cached = readJsonSafe(file)
    if (!cached) throw e
    manifestMem = cached
    manifestAt = Date.now() - 9 * 60 * 1000 // попробуем обновить через минуту
  }
  return manifestMem
}

async function getFabricGames () {
  if (fabricGamesMem) return fabricGamesMem
  const file = path.join(cacheDir(), 'fabric_games.json')
  try {
    const list = await fetchJson(FABRIC_GAMES_URL)
    writeJson(file, list)
    fabricGamesMem = new Set(list.map(g => g.version))
  } catch {
    const cached = readJsonSafe(file)
    const set = new Set((cached || []).map(g => g.version))
    // Пустой список после сбоя не запоминаем — попробуем снова в следующий раз.
    if (!set.size) return set
    fabricGamesMem = set
  }
  return fabricGamesMem
}

function isInstalled (id) {
  const dir = path.join(versionsDir(), id)
  return fs.existsSync(path.join(dir, `${id}.json`)) && fs.existsSync(path.join(dir, `${id}.jar`))
}

// Fabric-профили: versions/fabric-loader-<loader>-<game>/
function fabricProfilesFor (gameVersion) {
  const dir = versionsDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => {
    if (!name.startsWith('fabric-loader-')) return false
    const json = readJsonSafe(path.join(dir, name, `${name}.json`))
    return json && json.inheritsFrom === gameVersion
  })
}

function isProfileInstalled (profile) {
  if (profile.loader === 'fabric') {
    return fabricProfilesFor(profile.version).some(id => isInstalled(id))
  }
  return isInstalled(profile.version)
}

async function listVersions () {
  const [manifest, fabric] = await Promise.all([getManifest(), getFabricGames()])
  const versions = manifest.versions.map(v => ({
    id: v.id,
    type: v.type,
    releaseTime: v.releaseTime,
    installed: isInstalled(v.id) || fabricProfilesFor(v.id).some(isInstalled),
    vanillaInstalled: isInstalled(v.id),
    fabricInstalled: fabricProfilesFor(v.id).some(isInstalled),
    fabric: fabric.has(v.id)
  }))
  return { latest: manifest.latest, versions }
}

async function getVersionMeta (id) {
  safeName(id)
  const candidates = [id, ...fabricProfilesFor(id)].map(d => path.join(versionsDir(), d, `${id}.json`))
  for (const file of candidates) {
    const local = readJsonSafe(file)
    if (local && local.id === id && local.downloads) return local
  }
  const manifest = await getManifest()
  const entry = manifest.versions.find(v => v.id === id)
  if (!entry) throw new Error(`Версия ${id} не найдена`)
  return fetchJson(entry.url)
}

function deleteVersion (id) {
  safeName(id)
  const targets = [id, ...fabricProfilesFor(id)]
  for (const name of targets) {
    fs.rmSync(inside(versionsDir(), name), { recursive: true, force: true })
    fs.rmSync(path.join(root(), 'natives', name), { recursive: true, force: true })
  }
  return true
}

module.exports = {
  getManifest,
  getFabricGames,
  listVersions,
  getVersionMeta,
  deleteVersion,
  isInstalled,
  isProfileInstalled,
  fabricProfilesFor,
  readJsonSafe,
  writeJson,
  versionsDir
}
