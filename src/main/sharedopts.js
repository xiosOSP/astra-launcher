'use strict'
// Общее управление для всех версий и сборок: клавиши, мышь, звук.
// После игры лаунчер запоминает эти строки из options.txt сборки, а перед запуском
// любой другой сборки записывает их туда. Клавиши в старых версиях (до 1.13) хранятся
// числами, в новых — именами («key.keyboard.w»), поэтому у них два отдельных набора.
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const COMMON = /^(mouseSensitivity|invertYMouse|rawMouseInput|discrete_mouse_scroll|mouseWheelSensitivity|autoJump|toggleCrouch|toggleSprint|guiScale|soundCategory_\w+)$/

function storeFile () {
  return path.join(app.getPath('userData'), 'shared-options.json')
}

function readStore () {
  try {
    const s = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    return { common: s.common || {}, keysNew: s.keysNew || {}, keysOld: s.keysOld || {}, updatedAt: s.updatedAt || 0 }
  } catch { return { common: {}, keysNew: {}, keysOld: {}, updatedAt: 0 } }
}

function writeStore (st) {
  const file = storeFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify({ ...st, updatedAt: Date.now() }, null, 2))
  fs.renameSync(file + '.tmp', file)
}

function parseOptions (text) {
  const out = new Map()
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out.set(line.slice(0, i), line.slice(i + 1))
  }
  return out
}

// Какие строки делятся между версиями.
function pick (opts) {
  const common = {}; const keysNew = {}; const keysOld = {}
  for (const [k, v] of opts) {
    if (COMMON.test(k)) common[k] = v
    else if (k.startsWith('key_')) {
      if (/^-?\d+$/.test(v)) keysOld[k] = v
      else if (/^key\.(keyboard|mouse)\./.test(v)) keysNew[k] = v
    }
  }
  return { common, keysNew, keysOld }
}

// После игры: запоминаем настройки этой сборки как общие.
// keys=false — клавиши в эту сборку перед игрой не записывались (новая сборка):
// в ней стоят клавиши по умолчанию, и общими они стать не должны.
function capture (instDir, { keys = true } = {}) {
  const file = path.join(instDir, 'options.txt')
  if (!fs.existsSync(file)) return false
  const got = pick(parseOptions(fs.readFileSync(file, 'utf8')))
  const st = readStore()
  Object.assign(st.common, got.common)
  // Клавиши берём, если их синхронизировали в этом запуске или общих клавиш ещё нет.
  if (Object.keys(got.keysNew).length && (keys || !Object.keys(st.keysNew).length)) st.keysNew = { ...st.keysNew, ...got.keysNew }
  if (Object.keys(got.keysOld).length && (keys || !Object.keys(st.keysOld).length)) st.keysOld = { ...st.keysOld, ...got.keysOld }
  writeStore(st)
  return true
}

// Перед запуском: записываем общие настройки в options.txt сборки.
// hint — формат клавиш по версии игры ('old' до 1.13, 'new' после), если в файле клавиш ещё нет.
function apply (instDir, hint = null) {
  const st = readStore()
  if (!st.updatedAt) return { changed: 0, keys: false }
  const file = path.join(instDir, 'options.txt')
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const opts = parseOptions(text)
  // Формат клавиш определяем по самой сборке, а если клавиш в файле нет — по версии игры.
  let keyStyle = null
  for (const [k, v] of opts) {
    if (!k.startsWith('key_')) continue
    keyStyle = /^-?\d+$/.test(v) ? 'old' : 'new'
    break
  }
  const hasKeys = keyStyle !== null
  if (!keyStyle) keyStyle = hint
  const keySet = keyStyle === 'old' ? st.keysOld : keyStyle === 'new' ? st.keysNew : {}
  // В новых версиях (1.13+) файл без строки version: игра прогоняет через перевод
  // старых числовых клавиш — клавиши-имена в таком файле могут сбросить все настройки.
  // Поэтому в новую сборку клавиши пишем со второго запуска, когда игра уже создала файл.
  const keysOk = hasKeys || keyStyle === 'old' || opts.has('version')
  const want = { ...st.common, ...(keysOk ? keySet : {}) }
  let changed = 0
  const lines = text ? text.split(/\r?\n/) : []
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    const j = lines[i].indexOf(':')
    if (j <= 0) continue
    const k = lines[i].slice(0, j)
    if (!(k in want)) continue
    seen.add(k)
    if (lines[i].slice(j + 1) !== want[k]) { lines[i] = `${k}:${want[k]}`; changed++ }
  }
  // Общие настройки, которых в файле нет, дописываем. Клавиши — только если в файле их
  // ещё нет совсем (новая сборка): иначе дописали бы действия, которых нет в этой версии.
  const extra = hasKeys || !keysOk ? st.common : { ...st.common, ...keySet }
  for (const [k, v] of Object.entries(extra)) {
    if (!seen.has(k)) { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push(`${k}:${v}`); changed++ }
  }
  if (changed) {
    fs.mkdirSync(instDir, { recursive: true })
    fs.writeFileSync(file, lines.join('\n') + '\n')
  }
  return { changed, keys: keysOk && Object.keys(keySet).length > 0 }
}

// Перенос из другого лаунчера: берём его options.txt как общие настройки.
function seedFrom (optionsFile) {
  if (!fs.existsSync(optionsFile)) return false
  const got = pick(parseOptions(fs.readFileSync(optionsFile, 'utf8')))
  const st = readStore()
  Object.assign(st.common, got.common)
  Object.assign(st.keysNew, got.keysNew)
  Object.assign(st.keysOld, got.keysOld)
  writeStore(st)
  return true
}

module.exports = { capture, apply, seedFrom, parseOptions, pick }
