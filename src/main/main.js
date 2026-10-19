'use strict'
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, nativeTheme } = require('electron')

const settings = require('./settings')
const versions = require('./versions')
const content = require('./content')
const screenshots = require('./screenshots')
const game = require('./game')
const updater = require('./updater')
const stats = require('./stats')
const worlds = require('./worlds')
const profiles = require('./profiles')
const { hasNonAscii } = require('./paths')
const { MOCK } = require('./net')

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
    minWidth: 1080,
    minHeight: 680,
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
    case 'logs': return profiles.subDir(profile, kind, true)
    case 'instances': return profiles.instancesDir()
    default: throw new Error('Неизвестная папка')
  }
}

// Пока игра запущена, файлы её сборки трогать нельзя (в Windows они заблокированы).
function assertNotRunning (profile) {
  if (game.state === 'idle' || !game.profile || !profile) return
  const p = profiles.normalize(profile)
  if (p.version === game.profile.version && p.loader === game.profile.loader) {
    throw new Error('Сначала закрой игру — её файлы сейчас заняты')
  }
}

function rememberProfile (profile) {
  const p = profiles.normalize(profile)
  const recent = [p, ...settings.load().recentProfiles.filter(r => !(r.version === p.version && r.loader === p.loader))]
  return settings.save({ profile: p, recentProfiles: recent.slice(0, 6) })
}

function registerIpc () {
  handle('app:info', () => ({
    version: app.getVersion(),
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
    const allowed = ['nickname', 'nicknames', 'memoryGb', 'javaPath', 'gameDir', 'width', 'height', 'fullscreen', 'afterLaunch', 'jvmArgs', 'showSnapshots', 'autoUpdate', 'autoBackup', 'keepBackups', 'discordStatus']
    if ('nickname' in (patch || {}) && game.state !== 'idle') throw new Error('Ник можно сменить, когда игра закрыта')
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

  // ---------- статистика ----------
  handle('stats:get', () => stats.get())

  // ---------- миры ----------
  const worldBusy = profile => {
    const p = profiles.normalize(profile)
    if (game.state !== 'idle' && game.profile && game.profile.version === p.version && game.profile.loader === p.loader) {
      throw new Error('Сначала закрой игру — миры этой сборки сейчас открыты')
    }
    return p
  }
  handle('worlds:list', profile => worlds.list(profiles.normalize(profile)))
  handle('worlds:backup', ({ profile, world }) => worlds.backup(profiles.normalize(profile), String(world)))
  handle('worlds:restore', ({ profile, world, file }) => worlds.restore(worldBusy(profile), String(world), file))
  handle('worlds:removeBackup', ({ profile, world, file }) => worlds.removeBackup(profiles.normalize(profile), String(world), file))
  handle('worlds:openBackups', ({ profile, world }) => {
    const dir = worlds.backupsDir(profiles.normalize(profile), String(world))
    fs.mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
  handle('worlds:openWorld', ({ profile, world }) => {
    const dir = path.join(profiles.subDir(profiles.normalize(profile), 'saves'), require('./paths').safeName(String(world)))
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

  handle('game:launch', profile => {
    rememberProfile(profile)
    return game.launch(profile)
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

game.setHooks({
  send,
  onSpawn (child, afterLaunch) {
    if (!win) return
    if (afterLaunch === 'hide') win.hide()
    if (afterLaunch === 'close') {
      // Игра запущена отдельно (detached) и продолжит работать без лаунчера.
      child.unref()
      setTimeout(() => app.quit(), 1500)
    }
  },
  onExit (crashed) {
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
