'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { settingsFile, defaultGameDir } = require('./paths')

const { SHORTCUT_DEFAULTS, sanitizeShortcuts } = require('./shortcuts')

// IPC patch schema is shared with the main process and covered by tests.
const ALLOWED_PATCH_FIELDS = Object.freeze(['nickname', 'nicknames', 'memoryGb', 'javaPath', 'gameDir', 'width', 'height', 'fullscreen', 'afterLaunch', 'jvmArgs', 'showSnapshots', 'autoUpdate', 'autoBackup', 'keepBackups', 'discordStatus', 'servers', 'account', 'gameLanguage', 'memoryMode', 'lightMode', 'sharedControls', 'shortcuts', 'muteWarnings', 'migrationOffered'])

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
    servers: [],
    account: '',
    gameLanguage: 'ru_ru',
    memoryMode: 'auto', // auto | manual
    lightMode: 'auto', // auto | on | off — облегчённая графика для новых сборок
    sharedControls: true, // общее управление, мышь и звук во всех версиях
    shortcuts: { ...SHORTCUT_DEFAULTS }, // горячие клавиши только внутри лаунчера
    muteWarnings: [], // предупреждения перед запуском, которые просили не показывать
    migrationOffered: false, // предлагали ли перенести данные из TLauncher
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
  const out = { version, loader }
  if (typeof p.pack === 'string' && /^[A-Za-z0-9]{6,12}$/.test(p.pack)) { out.pack = p.pack; out.loader = 'fabric' }
  return out
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
    // Активный аккаунт Ely.by (id профиля). Пусто — играем по нику.
    account: typeof s.account === 'string' && /^[0-9a-f]{32}$/.test(s.account) ? s.account : '',
    // Язык игры: ставится в options.txt каждой сборки один раз. Пусто — не трогать.
    gameLanguage: ['ru_ru', 'uk_ua', 'be_by', 'kk_kz', 'en_us', ''].includes(s.gameLanguage) ? s.gameLanguage : 'ru_ru',
    servers: (Array.isArray(s.servers) ? s.servers : [])
      .filter(x => x && typeof x.address === 'string' && /^[A-Za-z0-9.\-_]{1,253}(:\d{1,5})?$/.test(x.address.trim()))
      .map(x => ({ name: String(x.name || x.address).trim().slice(0, 40) || x.address, address: x.address.trim() }))
      .slice(0, 30),
    memoryGb: clampInt(s.memoryGb, 1, Math.max(2, usableRamGb() - 1), d.memoryGb),
    // Старые настройки без режима памяти: если память меняли руками — оставляем ручной режим.
    memoryMode: ['auto', 'manual'].includes(s.memoryMode)
      ? s.memoryMode
      : (raw && raw.memoryGb !== undefined && Number(raw.memoryGb) !== d.memoryGb ? 'manual' : 'auto'),
    lightMode: ['auto', 'on', 'off'].includes(s.lightMode) ? s.lightMode : 'auto',
    sharedControls: s.sharedControls !== false,
    shortcuts: sanitizeShortcuts(s.shortcuts),
    muteWarnings: (Array.isArray(s.muteWarnings) ? s.muteWarnings : []).filter(x => typeof x === 'string' && x.length <= 200).slice(-100),
    migrationOffered: !!s.migrationOffered,
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

module.exports = { load, save, gameDir, totalRamGb, usableRamGb, NICK_RE, defaultGameDir, ALLOWED_PATCH_FIELDS }
