'use strict'
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, nativeTheme, Tray, Menu, nativeImage, clipboard, Notification } = require('electron')

const settings = require('./settings')
const versions = require('./versions')
const content = require('./content')
const screenshots = require('./screenshots')
const game = require('./game')
const updater = require('./updater')
const stats = require('./stats')
const worlds = require('./worlds')
const modpacks = require('./modpacks')
const servers = require('./servers')
const accounts = require('./accounts')
const profiles = require('./profiles')
const { hasNonAscii } = require('./paths')
const { MOCK } = require('./net')
const precheck = require('./precheck')
const storage = require('./storage')
const share = require('./share')
const migrate = require('./migrate')
const perf = require('./perf')

const RENDERER = path.join(__dirname, '..', 'renderer')
const SODIUM_ID = 'AANobbMI' // Sodium на Modrinth

let win = null

// Для разработки и тестов: отдельная папка настроек.
if (process.env.ASTRA_USER_DATA) app.setPath('userData', process.env.ASTRA_USER_DATA)

// Второй экземпляр лаунчера не нужен — просто показываем первый.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function send (channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow () {
  nativeTheme.themeSource = 'dark'
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#0F0809',
    title: 'AstraLauncher',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  win.loadURL('app://renderer/index.html')
  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => send('win:state', { maximized: true }))
  win.on('unmaximize', () => send('win:state', { maximized: false }))

  // Никаких переходов и новых окон внутри лаунчера: ссылки — в системный браузер.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
}

function registerProtocol () {
  protocol.handle('app', req => {
    const u = new URL(req.url)
    let file
    try {
      if (u.host === 'renderer') {
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '')
        file = path.resolve(RENDERER, rel)
        if (!file.startsWith(RENDERER + path.sep)) throw new Error('forbidden')
      } else if (u.host === 'shots') {
        const [, inst, name] = u.pathname.split('/')
        file = screenshots.resolve(decodeURIComponent(inst), decodeURIComponent(name))
      } else if (u.host === 'worlds') {
        const [, inst, world, name] = u.pathname.split('/')
        if (name !== 'icon.png') throw new Error('forbidden')
        file = worlds.iconPath(decodeURIComponent(inst), decodeURIComponent(world))
      } else {
        throw new Error('forbidden')
      }
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

// ---------- IPC ----------
// Ошибки отдаём в рендерер одной строкой, без стека.
function handle (channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents) throw new Error('forbidden')
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) }
    }
  })
}

function folderFor (kind, profile) {
  const root = settings.gameDir()
  switch (kind) {
    case 'root': return root
    case 'instance': return profiles.instanceDir(profile, true)
    case 'mods':
    case 'resourcepacks':
    case 'screenshots':
    case 'saves':
    case 'shaderpacks':
    case 'logs': return profiles.subDir(profile, kind, true)
    case 'instances': return profiles.instancesDir()
    default: throw new Error('Неизвестная папка')
  }
}

// Пока игра запущена, файлы её сборки трогать нельзя (в Windows они заблокированы).
function assertNotRunning (profile) {
  if (game.state === 'idle' || !game.profile || !profile) return
  const p = profiles.normalize(profile)
  if (profiles.sameProfile(p, game.profile)) {
    throw new Error('Сначала закрой игру — её файлы сейчас заняты')
  }
}

function rememberProfile (profile) {
  const p = profiles.normalize(profile)
  const recent = [p, ...settings.load().recentProfiles.filter(r => !profiles.sameProfile(r, p))]
  return settings.save({ profile: p, recentProfiles: recent.slice(0, 6) })
}

function registerIpc () {
  handle('app:info', () => ({
    version: require('./appversion').label(app.getVersion()),
    rawVersion: app.getVersion(),
    platform: process.platform,
    totalRamGb: settings.totalRamGb(),
    usableRamGb: settings.usableRamGb(),
    defaultGameDir: settings.defaultGameDir(),
    gameDir: settings.gameDir(),
    gameDirNonAscii: hasNonAscii(settings.gameDir()),
    mock: MOCK
  }))

  handle('settings:get', () => settings.load())
  handle('settings:set', patch => {
    const allowed = settings.ALLOWED_PATCH_FIELDS
    if (('nickname' in (patch || {}) || 'account' in (patch || {})) && game.state !== 'idle') throw new Error('Ник можно сменить, когда игра закрыта')
    if (patch && patch.account && !accounts.list().some(a => a.id === patch.account)) throw new Error('Такого аккаунта нет')
    const clean = {}
    for (const k of allowed) if (patch && k in patch) clean[k] = patch[k]
    if ('nickname' in clean && !settings.NICK_RE.test(String(clean.nickname))) {
      throw new Error('Ник: от 3 до 16 символов — латиница, цифры и _')
    }
    if ('gameDir' in clean && clean.gameDir && !path.isAbsolute(clean.gameDir)) {
      throw new Error('Укажи полный путь к папке')
    }
    if ('gameDir' in clean && game.state !== 'idle') throw new Error('Нельзя менять папку, пока игра запущена')
    if ('javaPath' in clean) {
      clean.javaPath = String(clean.javaPath || '').trim().replace(/^"(.*)"$/, '$1')
      if (clean.javaPath && !/^javaw?(\.exe)?$/i.test(path.basename(clean.javaPath))) {
        throw new Error('Укажи файл java или javaw (в Windows — java.exe или javaw.exe)')
      }
      if (clean.javaPath && !path.isAbsolute(clean.javaPath)) throw new Error('Укажи полный путь к Java')
    }
    return settings.save(clean)
  })

  handle('profile:select', profile => rememberProfile(profile))

  handle('versions:list', () => versions.listVersions())
  handle('versions:delete', id => {
    if (game.state !== 'idle' && game.profile && game.profile.version === id) throw new Error('Сначала закрой игру')
    return versions.deleteVersion(id)
  })

  handle('content:search', params => content.search(params))
  handle('content:list', params => content.list(params))
  handle('content:installedIds', params => content.installedIds(params))
  handle('content:toggle', params => { assertNotRunning(params && params.profile); return content.toggle(params) })
  handle('content:remove', params => { assertNotRunning(params && params.profile); return content.remove(params) })
  handle('content:checkUpdates', params => content.checkUpdates(params))
  // Обновление одного или нескольких файлов — одним снимком для «Вернуть как было».
  handle('content:update', async params => {
    assertNotRunning(params && params.profile)
    const files = Array.isArray(params && params.files) ? params.files.map(String) : [String(params && params.file)]
    const key = files.length === 1 ? 'upd:' + files[0] : 'upd:all'
    try {
      const res = await content.updateMany({ profile: params.profile, type: params.type, files }, st => send('task:status', { key, ...st }))
      send('task:status', { key, done: true })
      if (files.length === 1 && res.errors.length) throw new Error(res.errors[0].error)
      return res
    } catch (e) {
      send('task:status', { key, done: true, error: e.message })
      throw e
    }
  })
  handle('content:rollbackInfo', params => content.rollbackInfo(params || {}))
  handle('content:rollback', params => { assertNotRunning(params && params.profile); return content.rollback(params || {}) })
  handle('content:install', async params => {
    assertNotRunning(params && params.profile)
    const key = params && params.projectId
    send('task:status', { key, stage: 'В очереди' })
    try {
      const res = await content.install(params, st => send('task:status', { key, ...st }))
      send('task:status', { key, done: true })
      return res
    } catch (e) {
      send('task:status', { key, done: true, error: e.message })
      throw e
    }
  })

  // «Ускорить игру»: профиль с Fabric + Sodium.
  handle('boost', async profile => {
    const p = { version: profiles.normalize(profile).version, loader: 'fabric' }
    assertNotRunning(p)
    const fabric = await versions.getFabricGames()
    if (!fabric.has(p.version)) throw new Error(`Fabric пока не вышел для ${p.version}`)
    const res = await content.install({ projectId: SODIUM_ID, profile: p, type: 'mod' },
      st => send('task:status', { key: 'boost', ...st }))
    send('task:status', { key: 'boost', done: true })
    rememberProfile(p)
    return { profile: p, ...res }
  })

  handle('shots:list', () => screenshots.list())
  handle('shots:remove', params => screenshots.remove(params))

  // ---------- обновления ----------
  handle('update:state', () => updater.getState())
  handle('update:check', () => updater.check())
  handle('update:download', () => updater.downloadUpdate())
  handle('update:install', () => {
    if (game.state !== 'idle') throw new Error('Сначала закрой игру')
    return updater.installAndRestart()
  })
  handle('update:openPage', () => shell.openExternal(updater.RELEASES_PAGE))

  // ---------- сборки модов ----------
  handle('packs:search', params => modpacks.search(params))
  handle('packs:list', () => modpacks.list())
  handle('packs:checkUpdate', id => modpacks.checkUpdate(id))
  handle('packs:install', async id => {
    if (game.state !== 'idle' && game.profile && game.profile.pack === id) throw new Error('Сначала закрой игру')
    const key = 'pack:' + id
    send('task:status', { key, stage: 'В очереди' })
    try {
      const res = await modpacks.install(id, st => send('task:status', { key, ...st }))
      send('task:status', { key, done: true })
      rememberProfile(res.profile)
      return res
    } catch (e) {
      send('task:status', { key, done: true, error: e.message })
      throw e
    }
  })
  handle('packs:remove', id => {
    if (game.state !== 'idle' && game.profile && game.profile.pack === id) throw new Error('Сначала закрой игру')
    const s = settings.load()
    modpacks.remove(id)
    // Убираем сборку из недавних и, если она выбрана, переключаемся на обычную версию.
    const recent = s.recentProfiles.filter(p => p.pack !== id)
    const patch = { recentProfiles: recent }
    if (s.profile.pack === id) patch.profile = { version: s.profile.version, loader: 'vanilla' }
    return settings.save(patch)
  })

  // ---------- аккаунты Ely.by ----------
  handle('accounts:list', () => accounts.list())
  handle('accounts:login', params => accounts.login(params || {}))
  handle('accounts:logout', async id => {
    if (game.state !== 'idle') throw new Error('Сначала закрой игру')
    await accounts.logout(String(id))
    if (settings.load().account === id) settings.save({ account: '' })
    return settings.load()
  })

  // ---------- сервера ----------
  handle('servers:ping', address => servers.ping(String(address)))

  // ---------- статистика ----------
  handle('stats:get', () => stats.get())

  // ---------- миры ----------
  const worldBusy = profile => {
    const p = profiles.normalize(profile)
    if (game.state !== 'idle' && profiles.sameProfile(p, game.profile)) {
      throw new Error('Сначала закрой игру — миры этой сборки сейчас открыты')
    }
    return p
  }
  handle('worlds:list', profile => worlds.list(profiles.normalize(profile)))
  handle('worlds:backup', ({ profile, world }) => worlds.backup(worldBusy(profile), String(world)))
  handle('worlds:restore', ({ profile, world, file }) => worlds.restore(worldBusy(profile), String(world), file))
  handle('worlds:removeBackup', ({ profile, world, file }) => worlds.removeBackup(profiles.normalize(profile), String(world), file))
  handle('worlds:openBackups', ({ profile, world }) => {
    const dir = worlds.backupsDir(profiles.normalize(profile), String(world))
    fs.mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
  handle('worlds:openWorld', ({ profile, world }) => {
    const dir = require('./paths').inside(profiles.subDir(profiles.normalize(profile), 'saves'), require('./paths').worldName(String(world)))
    return shell.openPath(dir)
  })

  // Отчёт о вылете: открываем только файлы из crash-reports/ или hs_err_pid*.log внутри сборок.
  handle('shell:openReport', file => {
    const p = path.resolve(String(file))
    const base = profiles.instancesDir()
    const rel = path.relative(base, p)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('forbidden')
    if (!/(crash-reports[\\/]crash-.*\.txt|hs_err_pid\d+\.log)$/.test(p)) throw new Error('forbidden')
    return shell.openPath(p)
  })

  handle('game:launch', (profile, opts = {}) => {
    rememberProfile(profile)
    const server = opts && opts.server ? String(opts.server) : null
    if (server) servers.parseAddress(server) // проверка адреса
    const world = opts && opts.world ? require('./paths').worldName(String(opts.world)) : null
    return game.launch(profile, { server, friend: !!(opts && opts.friend), world })
  })
  handle('game:precheck', profile => precheck.run(profile))
  handle('warnings:mute', id => {
    const list = settings.load().muteWarnings.filter(x => x !== String(id))
    return settings.save({ muteWarnings: [...list, String(id).slice(0, 200)] })
  })

  // ---------- производительность ----------
  handle('perf:info', async profile => {
    const m = await perf.machine()
    let memory = null
    try {
      const p = profiles.normalize(profile)
      memory = perf.memoryFor(p, profiles.instanceDir(p), { ...settings.load(), memoryMode: 'auto' })
    } catch {}
    return { ram: m.ram, cores: m.cores, weak: m.weak, integratedOnly: m.integratedOnly, noDriver: m.noDriver, autoMemory: memory }
  })

  // ---------- место на диске ----------
  handle('storage:scan', () => storage.scan())
  handle('storage:clean', kinds => {
    if (game.state !== 'idle') throw new Error('Сначала закрой игру')
    const allowedKinds = ['libs', 'assets', 'logs', 'temp', 'java']
    return storage.clean((Array.isArray(kinds) ? kinds : allowedKinds).filter(k => allowedKinds.includes(k)))
  })

  // ---------- поделиться сборкой ----------
  handle('packs:export', async ({ profile, name } = {}) => {
    const p = profiles.normalize(profile)
    const safe = String(name || `Сборка ${p.version}`).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Сборка'
    const r = await dialog.showSaveDialog(win, {
      title: 'Сохранить сборку',
      defaultPath: path.join(app.getPath('desktop'), `${safe}.mrpack`),
      filters: [{ name: 'Сборка Modrinth', extensions: ['mrpack'] }]
    })
    if (r.canceled || !r.filePath) return null
    const file = /\.mrpack$/i.test(r.filePath) ? r.filePath : r.filePath + '.mrpack'
    const res = await share.exportPack(p, file, { name: String(name || '').slice(0, 80) || undefined })
    shell.showItemInFolder(file)
    return res
  })
  handle('packs:import', async file => {
    let src = file ? String(file) : null
    if (!src) {
      const r = await dialog.showOpenDialog(win, { title: 'Файл сборки', properties: ['openFile'], filters: [{ name: 'Сборка Modrinth', extensions: ['mrpack'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      src = r.filePaths[0]
    }
    const key = 'pack:import'
    send('task:status', { key, stage: 'Открываю файл сборки' })
    try {
      const res = await modpacks.importFile(src, st => send('task:status', { key, ...st }))
      send('task:status', { key, done: true })
      rememberProfile(res.profile)
      return res
    } catch (e) {
      send('task:status', { key, done: true, error: e.message })
      throw e
    }
  })

  // ---------- перенос из TLauncher ----------
  handle('migrate:detect', dir => migrate.detect(dir ? String(dir) : undefined))
  handle('migrate:run', async params => {
    if (game.state !== 'idle') throw new Error('Сначала закрой игру')
    const res = await migrate.run(params || {}, st => send('task:status', { key: 'migrate', ...st }))
    send('task:status', { key: 'migrate', done: true })
    settings.save({ migrationOffered: true })
    return res
  })
  handle('game:stop', () => game.stop())
  handle('game:log', () => game.getLog())
  handle('game:status', () => game.lastStatus || { state: game.state })

  handle('shell:openFolder', ({ kind, profile } = {}) => {
    const dir = folderFor(kind, profile)
    fs.mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
  handle('shell:showFile', ({ instance, file }) => shell.showItemInFolder(screenshots.resolve(instance, file)))
  handle('shell:openExternal', url => {
    const u = new URL(String(url))
    if (u.protocol !== 'https:') throw new Error('Только https')
    return shell.openExternal(u.toString())
  })

  handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Папка для игры' })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('dialog:pickJava', async () => {
    const filters = process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : []
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Выбери java или javaw', filters })
    return r.canceled ? null : r.filePaths[0]
  })

  handle('win:minimize', () => win.minimize())
  handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  handle('win:close', () => win.close())
}

// ---------- значок возле часов ----------
// Пока идёт игра, лаунчер прячется в трей: оттуда его можно открыть или закрыть игру.
let tray = null
let trayAddress = null

function showWindow () {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function trayMenu () {
  const label = game.profile ? `${game.profile.version}${game.profile.loader === 'fabric' ? ' + Fabric' : ''}` : 'Minecraft'
  return Menu.buildFromTemplate([
    { label: `${label} · в игре`, enabled: false },
    ...(trayAddress ? [{ label: `Скопировать адрес для друга (${trayAddress})`, click: () => clipboard.writeText(trayAddress) }] : []),
    { type: 'separator' },
    { label: 'Открыть AstraLauncher', click: showWindow },
    { label: 'Закрыть игру', click: () => game.stop() },
    { type: 'separator' },
    { label: 'Выйти из лаунчера (игра продолжит работать)', click: () => app.quit() }
  ])
}

function createTray () {
  if (tray) return
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'icon.png')).resize({ width: 16, height: 16 })
    tray = new Tray(img)
    tray.setToolTip('AstraLauncher — игра запущена')
    tray.setContextMenu(trayMenu())
    tray.on('click', showWindow)
    tray.on('balloon-click', () => { if (trayAddress) clipboard.writeText(trayAddress); showWindow() })
  } catch { tray = null }
}

function destroyTray () {
  trayAddress = null
  if (tray) { try { tray.destroy() } catch {} tray = null }
}

game.setHooks({
  send,
  onFriendAddress (addr) {
    trayAddress = addr
    if (tray) {
      tray.setContextMenu(trayMenu())
      if (process.platform === 'win32') tray.displayBalloon({ title: 'Адрес для друга готов', content: `${addr}\nНажми, чтобы скопировать`, iconType: 'info' })
    } else if (Notification.isSupported() && (!win || !win.isFocused())) {
      const n = new Notification({ title: 'Адрес для друга готов', body: `${addr} — нажми, чтобы скопировать` })
      n.on('click', () => clipboard.writeText(addr))
      n.show()
    }
  },
  onSpawn (child, afterLaunch) {
    if (!win) return
    if (afterLaunch === 'hide') { win.hide(); createTray() }
    if (afterLaunch === 'close') {
      // Игра запущена отдельно (detached) и продолжит работать без лаунчера.
      child.unref()
      setTimeout(() => app.quit(), 1500)
    }
  },
  onExit (crashed) {
    destroyTray()
    if (win && !win.isDestroyed()) {
      win.show()
      if (crashed) win.focus()
    }
  }
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

updater.setEmitter(st => send('update:status', st))

app.whenReady().then(() => {
  registerProtocol()
  registerIpc()
  createWindow()
  // Проверка обновлений через пару секунд после старта, чтобы не мешать загрузке окна.
  if (settings.load().autoUpdate) setTimeout(() => updater.check(), 4000)
})

app.on('window-all-closed', () => app.quit())
