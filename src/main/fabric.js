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
async function ensureFabricProfile (gameVersion, wantLoader = null) {
  safeName(gameVersion)
  if (wantLoader && !/^[\w.+-]{1,40}$/.test(wantLoader)) wantLoader = null
  let loaders
  try {
    loaders = await fetchJson(`${META}/versions/loader/${encodeURIComponent(gameVersion)}`)
  } catch (e) {
    // Без сети используем уже скачанный профиль, если он есть.
    const local = fabricProfilesFor(gameVersion)
    const exact = wantLoader && local.find(id => id === `fabric-loader-${wantLoader}-${gameVersion}`)
    if (exact) return exact
    if (local.length) return local.sort().pop()
    throw e
  }
  if (!Array.isArray(loaders) || !loaders.length) {
    throw new Error(`Fabric не поддерживает ${gameVersion}`)
  }
  // Сборка модов может требовать конкретную версию загрузчика.
  const pick = (wantLoader && loaders.find(l => l.loader && l.loader.version === wantLoader)) ||
    loaders.find(l => l.loader && l.loader.stable) || loaders[0]
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
  // Клиент игры (~25 МБ) берём из другого профиля этой же версии, чтобы не качать заново.
  // Старые профили не удаляем: сборки модов могут требовать свою версию загрузчика.
  const newJar = path.join(versionsDir(), id, `${id}.jar`)
  if (!fs.existsSync(newJar)) {
    const donor = [gameVersion, ...fabricProfilesFor(gameVersion)]
      .map(d => path.join(versionsDir(), d, `${d}.jar`))
      .find(f => f !== newJar && fs.existsSync(f))
    if (donor) { try { fs.copyFileSync(donor, newJar) } catch {} }
  }
  return id
}

module.exports = { ensureFabricProfile }
