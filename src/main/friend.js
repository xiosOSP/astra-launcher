'use strict'
// «Играть с другом» без сервера: мод e4mc. Хост открывает мир «Для сети»,
// e4mc выдаёт публичный адрес, друг заходит по нему из обычного Minecraft.
// В сборках с Fabric мод ставится в папку mods. В обычной версии игра один раз
// запускается через Fabric, а e4mc и его зависимости подключаются из отдельной
// папки (-Dfabric.addMods) — папка обычной версии и её миры остаются как были.
const fs = require('fs')
const path = require('path')
const settings = require('./settings')
const versions = require('./versions')
const content = require('./content')
const { subDir } = require('./profiles')
const { safeName } = require('./paths')

const E4MC_ID = 'qANg5Jrr'

// Адрес, который e4mc пишет в чат (а чат попадает в лог игры).
const ADDRESS_RE = /\b((?:[a-z0-9-]+\.)+e4mc\.[a-z]{2,}(?::\d{2,5})?)\b/i

function friendDir (version) {
  return path.join(settings.gameDir(), 'friend-mods', safeName(version))
}

function hasE4mc (profile) {
  if (content.installedIds({ profile, type: 'mod' }).includes(E4MC_ID)) return true
  try { return fs.readdirSync(subDir(profile, 'mods')).some(f => /^e4mc.*\.jar$/i.test(f)) } catch { return false }
}

/**
 * Готовит игру с другом. Возвращает { addMods } — папку с модами для обычной версии
 * (или null, если мод поставлен прямо в сборку).
 */
async function prepare (profile, onStatus = () => {}) {
  const fabric = await versions.getFabricGames()
  if (!fabric.has(profile.version)) throw new Error(`Для ${profile.version} игра с другом недоступна: нужен Fabric, а он эту версию не поддерживает`)
  const v = await content.latestVersion(E4MC_ID, { version: profile.version }, 'mod')
  if (!v) throw new Error(`Для ${profile.version} игра с другом недоступна: мод e4mc есть только для более новых версий (1.18 и выше)`)
  if (profile.loader === 'fabric') {
    if (!hasE4mc(profile)) {
      onStatus({ stage: 'Ставлю мод для игры с другом' })
      await content.install({ projectId: E4MC_ID, profile, type: 'mod' }, onStatus)
    }
    return { addMods: null }
  }
  onStatus({ stage: 'Ставлю мод для игры с другом' })
  const dir = friendDir(profile.version)
  await content.installInto(dir, E4MC_ID, profile.version, onStatus)
  return { addMods: dir }
}

function findAddress (text) {
  const m = ADDRESS_RE.exec(String(text))
  return m ? m[1] : null
}

module.exports = { prepare, findAddress, friendDir, E4MC_ID }
