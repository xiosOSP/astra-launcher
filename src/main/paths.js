'use strict'
const path = require('path')
const os = require('os')
const { app } = require('electron')

// Java и старые версии Minecraft (LWJGL 2) плохо переносят не-ASCII символы в пути.
// Если в профиле Windows кириллица (C:\Users\Иван\...), по умолчанию кладём игру в C:\AstraLauncher.
function hasNonAscii (p) {
  return /[^\x20-\x7E]/.test(p)
}

function defaultGameDir () {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    const dir = path.join(appData, '.astralauncher')
    return hasNonAscii(dir) ? 'C:\\AstraLauncher' : dir
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AstraLauncher', 'game')
  }
  return path.join(os.homedir(), '.astralauncher')
}

function settingsFile () {
  return path.join(app.getPath('userData'), 'settings.json')
}

// Имя версии приходит из рендерера — проверяем, что это не путь.
function safeName (name) {
  if (typeof name !== 'string' || !name.length || name.length > 80) throw new Error('Некорректное имя')
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new Error('Некорректное имя')
  }
  if (/^[\s.]|[\s.]$/.test(name)) throw new Error('Некорректное имя')
  return name
}

// Гарантирует, что target лежит внутри base (защита от ../ и абсолютных путей).
function inside (base, ...parts) {
  const resolvedBase = path.resolve(base)
  const target = path.resolve(resolvedBase, ...parts)
  const rel = path.relative(resolvedBase, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Путь вне папки лаунчера')
  return target
}

module.exports = { defaultGameDir, settingsFile, safeName, inside, hasNonAscii }
