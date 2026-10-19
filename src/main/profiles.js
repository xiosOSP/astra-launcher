'use strict'
const fs = require('fs')
const path = require('path')
const settings = require('./settings')
const { safeName, inside } = require('./paths')

const PACK_RE = /^[A-Za-z0-9]{6,12}$/

// Профиль = версия + загрузчик (+ сборка модов). У каждого своя папка:
// моды, ресурспаки, миры, скриншоты. Сборка — отдельная папка pack-<id>.
function normalize (profile) {
  if (!profile || typeof profile !== 'object') throw new Error('Профиль не выбран')
  const version = safeName(String(profile.version || ''))
  const loader = profile.loader === 'fabric' ? 'fabric' : 'vanilla'
  const out = { version, loader }
  if (profile.pack) {
    if (!PACK_RE.test(String(profile.pack))) throw new Error('Некорректная сборка')
    out.pack = String(profile.pack)
    out.loader = 'fabric'
  }
  return out
}

function instanceName (profile) {
  const p = normalize(profile)
  if (p.pack) return `pack-${p.pack}`
  return p.loader === 'fabric' ? `${p.version}-fabric` : p.version
}

function sameProfile (a, b) {
  return !!a && !!b && a.version === b.version && a.loader === b.loader && (a.pack || '') === (b.pack || '')
}

function instancesDir () {
  return path.join(settings.gameDir(), 'instances')
}

function instanceDir (profile, create = false) {
  const dir = inside(instancesDir(), instanceName(profile))
  if (create) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function subDir (profile, kind, create = false) {
  const map = { mods: 'mods', resourcepacks: 'resourcepacks', shaderpacks: 'shaderpacks', screenshots: 'screenshots', saves: 'saves', logs: 'logs' }
  if (!map[kind]) throw new Error('Неизвестная папка')
  const dir = path.join(instanceDir(profile, create), map[kind])
  if (create) fs.mkdirSync(dir, { recursive: true })
  return dir
}

module.exports = { normalize, instanceName, instancesDir, instanceDir, subDir, sameProfile, PACK_RE }
