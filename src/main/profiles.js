'use strict'
const fs = require('fs')
const path = require('path')
const settings = require('./settings')
const { safeName, inside } = require('./paths')

// Профиль = версия + загрузчик. У каждого своя папка: моды, ресурспаки, миры, скриншоты.
function normalize (profile) {
  if (!profile || typeof profile !== 'object') throw new Error('Профиль не выбран')
  const version = safeName(String(profile.version || ''))
  const loader = profile.loader === 'fabric' ? 'fabric' : 'vanilla'
  return { version, loader }
}

function instanceName (profile) {
  const p = normalize(profile)
  return p.loader === 'fabric' ? `${p.version}-fabric` : p.version
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
  const map = { mods: 'mods', resourcepacks: 'resourcepacks', screenshots: 'screenshots', saves: 'saves', logs: 'logs' }
  if (!map[kind]) throw new Error('Неизвестная папка')
  const dir = path.join(instanceDir(profile, create), map[kind])
  if (create) fs.mkdirSync(dir, { recursive: true })
  return dir
}

module.exports = { normalize, instanceName, instancesDir, instanceDir, subDir }
