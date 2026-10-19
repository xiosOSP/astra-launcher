'use strict'
// Язык игры. Minecraft хранит его в options.txt строкой «lang:ru_ru».
// В новых версиях (1.11+) код в нижнем регистре (ru_ru), в старых — ru_RU.
//
// Правило: лаунчер ставит выбранный в настройках язык один раз для каждой сборки
// и запоминает это. Если игрок потом сменит язык в самой игре — лаунчер его не трогает.
// Если сменить язык в настройках лаунчера — он применится ко всем сборкам при следующем запуске.
const fs = require('fs')
const path = require('path')

const LANGS = ['ru_ru', 'uk_ua', 'be_by', 'kk_kz', 'en_us']

// Формат кода по списку ресурсов версии: есть ли файлы вида minecraft/lang/xx_xx.json.
function styleFromIndex (index) {
  const keys = Object.keys((index && index.objects) || {})
  if (keys.some(k => /^minecraft\/lang\/[a-z]{2,3}_[a-z]{2,3}\.json$/.test(k))) return 'lower'
  if (keys.some(k => /lang\/[a-z]{2,3}_[A-Z]{2,3}\.lang$/.test(k))) return 'upper'
  return 'lower'
}

function codeFor (lang, style) {
  if (style !== 'upper') return lang
  const [a, b] = lang.split('_')
  return `${a}_${(b || '').toUpperCase()}`
}

function readOptions (file) {
  try { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n') } catch { return null }
}

/**
 * instDir — папка сборки, lang — язык из настроек ('' — не трогать),
 * style — 'lower' | 'upper'. Возвращает записанный код или null.
 */
function apply (instDir, lang, style) {
  if (!lang || !LANGS.includes(lang)) return null
  const marker = path.join(instDir, '.astra', 'lang.txt')
  let applied = ''
  try { applied = fs.readFileSync(marker, 'utf8').trim() } catch {}
  if (applied === lang) return null // уже ставили — дальше решает игрок

  const code = codeFor(lang, style)
  const file = path.join(instDir, 'options.txt')
  const lines = readOptions(file) || []
  let found = false
  const out = lines.map(l => {
    if (/^lang:/.test(l)) { found = true; return `lang:${code}` }
    return l
  }).filter((l, i, arr) => !(i === arr.length - 1 && l === ''))
  if (!found) out.push(`lang:${code}`)
  fs.mkdirSync(instDir, { recursive: true })
  fs.writeFileSync(file, out.join('\n') + '\n')
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  fs.writeFileSync(marker, lang)
  return code
}

module.exports = { apply, styleFromIndex, codeFor, LANGS }
