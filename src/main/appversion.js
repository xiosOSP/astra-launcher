'use strict'
// Нумерация лаунчера.
//   0.2.0       — большое обновление (меняется вторая цифра);
//   0.2.0 [V1]  — небольшое обновление той же версии. В package.json это «0.2.0-v1»,
//                 тег релиза — «v0.2.0-v1» (квадратные скобки в тегах git запрещены).
// Старые версии 1.0.0–1.6.0 (до смены нумерации) считаются старше 0.2.0.

function parse (v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-v(\d+))?$/i.exec(String(v || '').trim())
  if (!m) return null
  let [major, minor, patch, rev] = [m[1], m[2], m[3], m[4] || 0].map(Number)
  // Старая нумерация 1.x → 0.1.x: всё это было до 0.2.0.
  if (major === 1 && minor <= 6) { major = 0; patch = minor * 100 + patch; minor = 1 }
  return [major, minor, patch, rev]
}

// a новее b?
function newer (a, b) {
  const x = parse(a); const y = parse(b)
  if (!x || !y) return false
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

// «0.2.0-v1» → «0.2.0 [V1]»
function label (v) {
  const m = /^v?(\d+\.\d+\.\d+)(?:-v(\d+))?$/i.exec(String(v || '').trim())
  if (!m) return String(v || '')
  return m[2] ? `${m[1]} [V${m[2]}]` : m[1]
}

// Числа для свойств .exe: 0.2.0-v1 → 0.2.0.1
function fileVersion (v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-v(\d+))?$/i.exec(String(v || ''))
  return m ? [m[1], m[2], m[3], m[4] || 0].map(Number) : [0, 0, 0, 0]
}

const FILE_RE = /^AstraLauncher-Portable-\d+\.\d+\.\d+(-v\d+)?\.exe$/

module.exports = { parse, newer, label, fileVersion, FILE_RE }
