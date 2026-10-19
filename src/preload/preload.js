'use strict'
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Узкий API для интерфейса. Каждый вызов возвращает данные или бросает понятную ошибку.
async function call (channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res || !res.ok) throw new Error((res && res.error) || 'Неизвестная ошибка')
  return res.data
}

const EVENTS = new Set(['game:status', 'game:log', 'task:status', 'win:state', 'update:status', 'worlds:autobackup'])

contextBridge.exposeInMainWorld('astra', {
  info: () => call('app:info'),
  settings: {
    get: () => call('settings:get'),
    set: patch => call('settings:set', patch)
  },
  selectProfile: profile => call('profile:select', profile),
  versions: {
    list: () => call('versions:list'),
    remove: id => call('versions:delete', id)
  },
  content: {
    search: params => call('content:search', params),
    install: params => call('content:install', params),
    list: params => call('content:list', params),
    installedIds: params => call('content:installedIds', params),
    toggle: params => call('content:toggle', params),
    remove: params => call('content:remove', params),
    checkUpdates: params => call('content:checkUpdates', params),
    update: params => call('content:update', params),
    rollbackInfo: params => call('content:rollbackInfo', params),
    rollback: params => call('content:rollback', params)
  },
  boost: profile => call('boost', profile),
  update: {
    state: () => call('update:state'),
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    openPage: () => call('update:openPage')
  },
  stats: () => call('stats:get'),
  accounts: {
    list: () => call('accounts:list'),
    login: params => call('accounts:login', params),
    logout: id => call('accounts:logout', id)
  },
  servers: {
    ping: address => call('servers:ping', address)
  },
  packs: {
    search: params => call('packs:search', params),
    list: () => call('packs:list'),
    install: id => call('packs:install', id),
    checkUpdate: id => call('packs:checkUpdate', id),
    remove: id => call('packs:remove', id),
    exportPack: (profile, name) => call('packs:export', { profile, name }),
    importFile: file => call('packs:import', file || null)
  },
  perf: profile => call('perf:info', profile),
  storage: {
    scan: () => call('storage:scan'),
    clean: kinds => call('storage:clean', kinds)
  },
  migrate: {
    detect: dir => call('migrate:detect', dir || null),
    run: params => call('migrate:run', params)
  },
  muteWarning: id => call('warnings:mute', id),
  // Путь к файлу, брошенному в окно (перетаскивание сборки .mrpack).
  pathForFile: file => { try { return webUtils.getPathForFile(file) } catch { return '' } },
  worlds: {
    list: profile => call('worlds:list', profile),
    backup: (profile, world) => call('worlds:backup', { profile, world }),
    restore: (profile, world, file) => call('worlds:restore', { profile, world, file }),
    removeBackup: (profile, world, file) => call('worlds:removeBackup', { profile, world, file }),
    openBackups: (profile, world) => call('worlds:openBackups', { profile, world }),
    openWorld: (profile, world) => call('worlds:openWorld', { profile, world })
  },
  shots: {
    list: () => call('shots:list'),
    remove: params => call('shots:remove', params)
  },
  game: {
    launch: (profile, opts) => call('game:launch', profile, opts || {}),
    stop: () => call('game:stop'),
    log: () => call('game:log'),
    status: () => call('game:status'),
    precheck: profile => call('game:precheck', profile)
  },
  shell: {
    openFolder: (kind, profile) => call('shell:openFolder', { kind, profile }),
    showFile: (instance, file) => call('shell:showFile', { instance, file }),
    openExternal: url => call('shell:openExternal', url),
    openReport: file => call('shell:openReport', file)
  },
  dialog: {
    pickFolder: () => call('dialog:pickFolder'),
    pickJava: () => call('dialog:pickJava')
  },
  win: {
    minimize: () => call('win:minimize'),
    maximize: () => call('win:maximize'),
    close: () => call('win:close')
  },
  on (channel, fn) {
    if (!EVENTS.has(channel)) throw new Error('Неизвестное событие')
    const listener = (_e, payload) => fn(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})
