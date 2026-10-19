'use strict'
const fs = require('fs')
const path = require('path')
const { fetchJson } = require('./net')
const { versionsDir, readJsonSafe, writeJson, fabricProfilesFor } = require('./versions')
const { safeName } = require('./paths')

const META = 'https://meta.fabricmc.net/v2'

/**
 * Готовит JSON профиля Fabric (versions/fabric-loader-X-Y/fabric-loader-X-Y.json).
 * Сам загрузчик и его библиотеки потом скачает minecraft-launcher-core.
 * Возвращает id профиля.
 */
async function ensureFabricProfile (gameVersion) {
  safeName(gameVersion)
  let loaders
  try {
    loaders = await fetchJson(`${META}/versions/loader/${encodeURIComponent(gameVersion)}`)
  } catch (e) {
    // Без сети используем уже скачанный профиль, если он есть.
    const local = fabricProfilesFor(gameVersion)
    if (local.length) return local.sort().pop()
    throw e
  }
  if (!Array.isArray(loaders) || !loaders.length) {
    throw new Error(`Fabric не поддерживает ${gameVersion}`)
  }
  const pick = loaders.find(l => l.loader && l.loader.stable) || loaders[0]
  const loaderVersion = pick.loader.version
  const id = `fabric-loader-${loaderVersion}-${gameVersion}`
  const file = path.join(versionsDir(), id, `${id}.json`)
  if (!readJsonSafe(file)) {
    const profile = await fetchJson(
      `${META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
    )
    if (!profile || profile.id !== id) throw new Error('Fabric прислал неожиданный профиль')
    writeJson(file, profile)
  }
  // Старые профили Fabric для этой же версии больше не нужны.
  // Клиент игры (~25 МБ) из старого профиля переносим, чтобы не качать заново.
  const newJar = path.join(versionsDir(), id, `${id}.jar`)
  for (const old of fabricProfilesFor(gameVersion)) {
    if (old === id) continue
    const oldJar = path.join(versionsDir(), old, `${old}.jar`)
    if (!fs.existsSync(newJar) && fs.existsSync(oldJar)) {
      try { fs.renameSync(oldJar, newJar) } catch {}
    }
    fs.rmSync(path.join(versionsDir(), old), { recursive: true, force: true })
  }
  return id
}

module.exports = { ensureFabricProfile }
