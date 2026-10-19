'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { settingsFile, defaultGameDir } = require('./paths')

const NICK_RE = /^[A-Za-z0-9_]{3,16}$/

// Память компьютера в ГБ: для текста округляем (8 ГБ, а не 7,8 → 7),
// для ползунка берём целую часть, чтобы не выдать игре больше, чем есть.
function totalRamGb () {
  return Math.max(2, Math.round(os.totalmem() / 1024 ** 3))
}

function usableRamGb () {
  return Math.max(2, Math.floor(os.totalmem() / 1024 ** 3))
}

function defaults () {
  const ram = usableRamGb()
  return {
    nickname: '',
    nicknames: [],
    autoUpdate: true,
    autoBackup: true,
    keepBackups: 5,
    discordStatus: true,
    memoryGb: Math.min(Math.max(2, Math.floor(ram / 2)), 6),
    javaPath: '',
    gameDir: '',
    width: 1280,
    height: 720,
    fullscreen: false,
    afterLaunch: 'hide', // hide | keep | close
    jvmArgs: '',
    showSnapshots: false,
    profile: { version: '', loader: 'vanilla' },
    recentProfiles: []
  }
}

let cache = null

function clampInt (v, min, max, fallback) {
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeProfile (p) {
  if (!p || typeof p !== 'object') return { version: '', loader: 'vanilla' }
  const version = typeof p.version === 'string' && p.version.length <= 80 && !/[\\/]|\.\./.test(p.version) ? p.version : ''
  const loader = p.loader === 'fabric' ? 'fabric' : 'vanilla'
  return { version, loader }
}

function sanitize (raw) {
  const d = defaults()
  const s = { ...d, ...(raw && typeof raw === 'object' ? raw : {}) }
  const out = {
    nickname: typeof s.nickname === 'string' && NICK_RE.test(s.nickname) ? s.nickname : '',
    // Все ники пользователя; активный всегда в списке.
    nicknames: [...new Set([
      ...(Array.isArray(s.nicknames) ? s.nicknames : []),
      ...(typeof s.nickname === 'string' && NICK_RE.test(s.nickname) ? [s.nickname] : [])
    ].filter(n => typeof n === 'string' && NICK_RE.test(n)))].slice(0, 10),
    autoUpdate: s.autoUpdate !== false,
    autoBackup: s.autoBackup !== false,
    keepBackups: clampInt(s.keepBackups, 1, 30, 5),
    discordStatus: s.discordStatus !== false,
    memoryGb: clampInt(s.memoryGb, 1, Math.max(2, usableRamGb() - 1), d.memoryGb),
    javaPath: typeof s.javaPath === 'string' ? s.javaPath.trim().slice(0, 500) : '',
    gameDir: typeof s.gameDir === 'string' ? s.gameDir.trim().slice(0, 500) : '',
    width: clampInt(s.width, 640, 7680, d.width),
    height: clampInt(s.height, 480, 4320, d.height),
    fullscreen: !!s.fullscreen,
    afterLaunch: ['hide', 'keep', 'close'].includes(s.afterLaunch) ? s.afterLaunch : 'hide',
    jvmArgs: typeof s.jvmArgs === 'string' ? s.jvmArgs.slice(0, 1000) : '',
    showSnapshots: !!s.showSnapshots,
    profile: sanitizeProfile(s.profile),
    recentProfiles: Array.isArray(s.recentProfiles)
      ? s.recentProfiles.map(sanitizeProfile).filter(p => p.version).slice(0, 6)
      : []
  }
  return out
}

function load () {
  if (cache) return cache
  try {
    cache = sanitize(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')))
  } catch {
    cache = sanitize({})
  }
  return cache
}

function save (patch) {
  const next = sanitize({ ...load(), ...patch })
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  // Пишем через временный файл, чтобы не потерять настройки при сбое.
  const tmp = settingsFile() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, settingsFile())
  cache = next
  return next
}

function gameDir () {
  return path.resolve(load().gameDir || defaultGameDir())
}

module.exports = { load, save, gameDir, totalRamGb, usableRamGb, NICK_RE, defaultGameDir }
