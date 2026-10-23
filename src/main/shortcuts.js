'use strict'

// Only allow predictable combinations inside the launcher window.
// Keep default ids and key codes in sync with renderer/js/ui/shortcuts.js.
const SHORTCUT_DEFAULTS = Object.freeze({
  home: 'Ctrl+Digit1', library: 'Ctrl+Digit2', mods: 'Ctrl+Digit3',
  worlds: 'Ctrl+Digit4', servers: 'Ctrl+Digit5', settings: 'Ctrl+Digit6',
  play: 'Ctrl+Enter', log: 'Ctrl+Shift+KeyL', help: 'F1'
})

const RESERVED = new Set([
  'Ctrl+KeyR', 'Ctrl+Shift+KeyR', 'Ctrl+KeyW', 'Ctrl+Shift+KeyW',
  'Ctrl+Shift+KeyI', 'Ctrl+Shift+KeyJ', 'Alt+F4', 'Alt+Space'
])

function validShortcut (v) {
  if (typeof v !== 'string' || !v || v.length > 40) return false
  const parts = v.split('+')
  const key = parts.pop()
  const mods = parts
  if (!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Enter|Space)$/.test(key)) return false
  if (mods.some(m => !['Ctrl', 'Alt', 'Shift'].includes(m)) || new Set(mods).size !== mods.length) return false
  if (mods.join('+') !== ['Ctrl', 'Alt', 'Shift'].filter(m => mods.includes(m)).join('+')) return false
  if (!mods.includes('Ctrl') && !mods.includes('Alt') && !/^F([1-9]|1[0-2])$/.test(key)) return false
  return !RESERVED.has(v)
}

function sanitizeShortcuts (raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  const used = new Set()
  for (const [id, fallback] of Object.entries(SHORTCUT_DEFAULTS)) {
    const wanted = Object.hasOwn(source, id) ? source[id] : fallback
    const key = wanted === '' ? '' : (validShortcut(wanted) ? wanted : fallback)
    out[id] = key && !used.has(key) ? key : ''
    if (out[id]) used.add(out[id])
  }
  return out
}

module.exports = { SHORTCUT_DEFAULTS, validShortcut, sanitizeShortcuts }
