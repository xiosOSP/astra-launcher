'use strict'
// Запуск игры. Порядок: версия → Java → Fabric → общий план загрузки →
// проверка и загрузка одной шкалой → запуск через minecraft-launcher-core.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Client } = require('minecraft-launcher-core')
const Handler = require('minecraft-launcher-core/components/handler')
const settings = require('./settings')
const versions = require('./versions')
const install = require('./install')
const { planJava, requiredJava, testJava, majorOf } = require('./java')
const { ensureFabricProfile } = require('./fabric')
const { normalize, instanceDir } = require('./profiles')
const modpacks = require('./modpacks')
const { Progress } = require('./progress')
const { MOCK, abortAll } = require('./net')
const stats = require('./stats')
const crash = require('./crash')
const worlds = require('./worlds')
const discord = require('./discord')

// Java мы проверяем сами (javaw.exe ничего не печатает в -version, из-за чего MCLC падает).
Handler.prototype.checkJava = function () { return Promise.resolve({ run: true }) }

// Все файлы мы уже проверили и докачали сами. Без этого MCLC при каждом запуске
// заново считал бы хеш нескольких тысяч файлов звуков.
const origCheckSum = Handler.prototype.checkSum
Handler.prototype.checkSum = function (hash, file) {
  if (this.options && this.options.astraVerified) return Promise.resolve(true)
  return origCheckSum.call(this, hash, file)
}

// По этим строкам лога понятно, что окно игры открылось.
const WINDOW_READY = /Setting user:|Backend library: LWJGL|LWJGL Version|OpenAL initialized|Sound engine started/
const READY_TIMEOUT = 25000

// UUID как у ванильного офлайн-режима: миры узнают игрока при каждом запуске.
function offlineUuid (name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name).digest()
  md5[6] = (md5[6] & 0x0f) | 0x30
  md5[8] = (md5[8] & 0x3f) | 0x80
  return md5.toString('hex')
}

function splitArgs (str) {
  // Простой разбор аргументов JVM с поддержкой кавычек.
  const out = []
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(str || ''))) out.push(m[1] !== undefined ? m[1] : m[2])
  return out
}

// Для своей Java на Windows берём javaw.exe, чтобы не открывалось окно консоли.
function preferJavaw (p) {
  if (process.platform !== 'win32' || !/java\.exe$/i.test(p)) return p
  const w = p.replace(/java\.exe$/i, 'javaw.exe')
  return fs.existsSync(w) ? w : p
}

function decodeXml (s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

class Game {
  constructor () {
    this.state = 'idle' // idle | preparing | starting | running
    this.child = null
    this.profile = null
    this.log = []
    this.pendingLog = []
    this.xmlBuf = ''
    this.userStopped = false
    this.cancelled = false
    this.hooks = { send: () => {}, onSpawn: () => {}, onExit: () => {} }
    this.progress = new Progress(patch => this.status(patch))
    setInterval(() => this.flushLog(), 200).unref()
  }

  setHooks (hooks) { Object.assign(this.hooks, hooks) }

  status (patch = {}) {
    this.lastStatus = { state: this.state, profile: this.profile, ...patch }
    this.hooks.send('game:status', this.lastStatus)
  }

  // ---------- лог ----------
  pushLog (text) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter(Boolean)
    for (const l of lines) {
      this.log.push(l)
      this.pendingLog.push(l)
    }
    if (this.log.length > 3000) this.log.splice(0, this.log.length - 3000)
  }

  // Вывод самой игры. Старые версии с настройками логов Mojang пишут события в XML —
  // переводим их в обычные строки «[поток/УРОВЕНЬ]: текст».
  pushGameOutput (chunk) {
    let text = String(chunk)
    if (!this.xmlBuf && !text.includes('<log4j:Event')) {
      this.pushLog(text)
      this.detectWindow(text)
      return
    }
    this.xmlBuf += text
    const out = []
    let start
    while ((start = this.xmlBuf.indexOf('<log4j:Event')) !== -1) {
      const before = this.xmlBuf.slice(0, start).trim()
      if (before) out.push(before)
      const end = this.xmlBuf.indexOf('</log4j:Event>', start)
      if (end === -1) { this.xmlBuf = this.xmlBuf.slice(start); break }
      const ev = this.xmlBuf.slice(start, end)
      this.xmlBuf = this.xmlBuf.slice(end + '</log4j:Event>'.length)
      const level = (/level="([^"]*)"/.exec(ev) || [])[1] || 'INFO'
      const thread = decodeXml((/thread="([^"]*)"/.exec(ev) || [])[1] || 'main')
      const msg = (/<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>/.exec(ev) || [])[1] || ''
      const thr = (/<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Throwable>/.exec(ev) || [])[1]
      out.push(`[${thread}/${level}]: ${msg}`)
      if (thr) out.push(thr)
    }
    if (this.xmlBuf.length > 200000) { out.push(this.xmlBuf); this.xmlBuf = '' }
    if (!this.xmlBuf.includes('<log4j:Event') && this.xmlBuf.trim() && !this.xmlBuf.trim().startsWith('<')) {
      out.push(this.xmlBuf); this.xmlBuf = ''
    }
    const joined = out.join('\n')
    if (joined) { this.pushLog(joined); this.detectWindow(joined) }
  }

  flushLog () {
    if (!this.pendingLog.length) return
    this.hooks.send('game:log', this.pendingLog.splice(0))
  }

  getLog () { return this.log.slice() }

  // ---------- запуск ----------
  checkCancel () {
    if (this.cancelled) throw new Error('Запуск отменён')
  }

  async launch (rawProfile, { server = null } = {}) {
    if (this.state !== 'idle') throw new Error('Игра уже запускается или запущена')
    const profile = normalize(rawProfile)
    const s = settings.load()
    if (!settings.NICK_RE.test(s.nickname)) throw new Error('Сначала укажи ник')

    this.state = 'preparing'
    this.profile = profile
    this.startedAt = Date.now()
    this.runStart = null
    const launchId = this.launchId = (this.launchId || 0) + 1
    this.userStopped = false
    this.cancelled = false
    this.log = []
    this.xmlBuf = ''
    this.progress.reset()
    if (server) this.pushLog(`[Astra] Сразу на сервер ${server}`)
    this.pushLog(`[Astra] Запуск ${profile.pack ? 'сборки ' + profile.pack + ', ' : ''}${profile.version}${profile.loader === 'fabric' ? ' + Fabric' : ''} как ${s.nickname}`)

    try {
      this.progress.setStage('Готовлю запуск')
      const vmeta = await versions.getVersionMeta(profile.version)
      this.checkCancel()

      // Java
      const need = requiredJava(vmeta)
      let javaPlan = null
      let javaPath = null
      if (s.javaPath) {
        const v = await testJava(s.javaPath)
        if (!v) throw new Error('Указанная Java не запускается. Проверь путь в настройках.')
        if (majorOf(v) < need) throw new Error(`Этой версии нужна Java ${need}, а в настройках указана Java ${majorOf(v)}`)
        javaPath = preferJavaw(s.javaPath)
      } else {
        javaPlan = await planJava(need)
      }
      this.checkCancel()

      // Fabric
      let custom
      let fabricJson = null
      if (profile.loader === 'fabric') {
        // Сборка модов может требовать свою версию загрузчика Fabric.
        const pack = profile.pack ? modpacks.readPackMeta(profile.pack) : null
        if (profile.pack && !pack) throw new Error('Сборка не найдена — установи её заново в разделе «Сборки»')
        custom = await ensureFabricProfile(profile.version, pack && pack.loaderVersion)
        fabricJson = versions.readJsonSafe(path.join(versions.versionsDir(), custom, `${custom}.json`))
        this.pushLog(`[Astra] Профиль Fabric: ${custom}`)
      }
      this.checkCancel()

      const root = settings.gameDir()
      const dirName = custom || profile.version
      // Кладём JSON версии туда, где его ждёт MCLC: так запуск работает и без интернета.
      const verJson = path.join(root, 'versions', dirName, `${profile.version}.json`)
      if (!fs.existsSync(verJson)) versions.writeJson(verJson, vmeta)

      // Общий план и загрузка одной шкалой.
      const planned = await install.plan({ root, vmeta, dirName, fabricJson, java: javaPlan })
      this.checkCancel()
      const installedJava = await install.run(planned, this.progress, () => this.cancelled)
      if (!javaPath) javaPath = installedJava
      this.pushLog(`[Astra] Java: ${javaPath}`)

      // Запуск
      this.state = 'starting'
      this.progress.complete('Запускаю игру')
      if (MOCK) return this.mockRun()

      const instDir = instanceDir(profile, true)
      const extractDir = path.join(root, 'natives', dirName)
      fs.mkdirSync(extractDir, { recursive: true })

      const client = new Client()
      client.on('debug', m => this.pushLog(String(m)))
      client.on('data', m => this.pushGameOutput(m))
      // События закрытия от процесса прошлого запуска не должны трогать текущий.
      client.on('close', code => { if (launchId === this.launchId) this.onClose(code) })

      const opts = {
        root,
        version: { number: profile.version, type: vmeta.type || 'release', custom },
        authorization: {
          access_token: crypto.randomBytes(16).toString('hex'),
          client_token: crypto.randomBytes(16).toString('hex'),
          uuid: offlineUuid(s.nickname),
          name: s.nickname,
          user_properties: '{}',
          meta: { type: 'mojang', demo: false }
        },
        memory: { max: `${s.memoryGb}G`, min: `${Math.min(1, s.memoryGb)}G` },
        javaPath,
        window: s.fullscreen ? { fullscreen: true } : { width: s.width, height: s.height },
        customArgs: [
          // Нативные библиотеки LWJGL/JNA/Netty — в папку лаунчера, а не во временную папку
          // профиля Windows (в ней часто кириллица).
          `-Dorg.lwjgl.system.SharedLibraryExtractPath=${extractDir}`,
          `-Djna.tmpdir=${extractDir}`,
          `-Dio.netty.native.workdir=${extractDir}`,
          ...splitArgs(s.jvmArgs)
        ],
        astraVerified: true,
        // Сразу зайти на сервер: в 1.20+ через quickPlay, в старых версиях через --server/--port.
        ...(server ? { quickPlay: { type: JSON.stringify(vmeta.arguments || {}).includes('quickPlayMultiplayer') ? 'multiplayer' : 'legacy', identifier: server.includes(':') ? server : server + ':25565' } } : {}),
        overrides: {
          gameDirectory: instDir,
          cwd: instDir, // логи игры попадут в папку сборки
          detached: true,
          maxSockets: 8,
          ...(planned.logConfig && fs.existsSync(planned.logConfig) ? { logj4ConfigurationFile: planned.logConfig } : {})
        }
      }
      const child = await client.launch(opts)
      if (!child) throw new Error('Игра не запустилась. Подробности в логе.')
      this.child = child
      child.on('error', e => {
        this.pushLog('[Astra] Не удалось запустить процесс игры: ' + e.message)
        if (launchId === this.launchId && this.state !== 'idle') this.onClose(-1)
      })
      if (this.cancelled) { this.stop(); throw new Error('Запуск отменён') }
      // Ждём, пока откроется окно игры (или 25 секунд — на случай незнакомого лога).
      this.readyTimer = setTimeout(() => this.markRunning(), READY_TIMEOUT)
      return true
    } catch (e) {
      this.pushLog('[Astra] Ошибка: ' + (e && e.stack || e))
      const msg = this.cancelled ? 'Запуск отменён' : (e.message || String(e))
      if (!this.child) {
        this.state = 'idle'
        this.status(this.cancelled ? { info: 'Запуск отменён. Уже скачанное сохранилось — в следующий раз загрузка продолжится.' } : { error: msg })
      }
      throw new Error(msg)
    }
  }

  detectWindow (text) {
    if (this.state === 'starting' && WINDOW_READY.test(text)) this.markRunning()
  }

  markRunning () {
    clearTimeout(this.readyTimer)
    if (this.state !== 'starting' || !this.child) return
    this.state = 'running'
    this.runStart = Date.now()
    stats.record(this.profile, { launch: true })
    if (settings.load().discordStatus) discord.playing({ ...this.profile, startedAt: this.runStart }).catch(() => {})
    this.status({ stage: 'Игра запущена' })
    this.hooks.onSpawn(this.child, settings.load().afterLaunch)
  }

  onClose (code) {
    if (this.state === 'idle') return
    clearTimeout(this.readyTimer)
    const phase = this.state
    this.state = 'idle'
    this.child = null
    if (this.xmlBuf) { this.pushLog(this.xmlBuf); this.xmlBuf = '' }
    this.pushLog(`[Astra] Игра закрылась, код ${code}`)
    this.flushLog()
    const failed = code !== 0 && code !== null && !this.userStopped && !this.cancelled
    const profile = this.profile
    if (this.runStart) {
      stats.record(profile, { playedMs: Date.now() - this.runStart })
    }
    const played = !!this.runStart
    this.runStart = null
    try { discord.clear() } catch {}
    let patch = this.cancelled ? { info: 'Запуск отменён.' } : {}
    if (failed) {
      const s = settings.load()
      let analysis = null
      try {
        analysis = crash.analyze({ lines: this.log, instDir: instanceDir(profile), startedAt: this.startedAt, memoryGb: s.memoryGb, code })
      } catch (e) { this.pushLog('[Astra] Не удалось разобрать вылет: ' + e.message) }
      const what = phase === 'running' ? 'Игра закрылась с ошибкой' : 'Игра не смогла запуститься'
      patch = { error: analysis ? `${what}: ${analysis.title.toLowerCase()}` : `${what} (код ${code}). Открой лог — там причина.`, crashed: true, crash: analysis }
    }
    this.status(patch)
    this.hooks.onExit(failed)
    // Копии миров — после игры, в фоне.
    if (played && settings.load().autoBackup) {
      worlds.autoBackup(profile, settings.load().keepBackups)
        .then(names => { if (names.length) this.hooks.send('worlds:autobackup', { profile, names }) })
        .catch(() => {})
    }
  }

  stop () {
    if (this.state === 'preparing' || this.state === 'starting') {
      this.cancelled = true
      abortAll('game')
    }
    if (this.child) {
      this.userStopped = true
      try { this.child.kill() } catch {}
    }
    return true
  }

  // Режим разработки без сети: имитируем запуск и работу игры.
  async mockRun () {
    const id = this.launchId
    this.child = { kill: () => setTimeout(() => { if (id === this.launchId) this.onClose(0) }, 300), unref () {} }
    await new Promise(r => setTimeout(r, 1500))
    if (this.cancelled || id !== this.launchId) return true
    this.pushGameOutput('<log4j:Event logger="bib" timestamp="1" level="INFO" thread="main">\n<log4j:Message><![CDATA[Setting user: ' + settings.load().nickname + ']]></log4j:Message>\n</log4j:Event>\n')
    // ASTRA_MOCK_CRASH=1 — имитация вылета из-за недостающего мода.
    if (process.env.ASTRA_MOCK_CRASH === '1') {
      setTimeout(() => {
        if (id !== this.launchId) return
        this.pushGameOutput([
          '[main/ERROR]: Incompatible mods found!',
          'net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!',
          'A potential solution has been determined, this may resolve your problem:',
          '\t - Install fabric-api, any version.',
          '\t - Replace \'Sodium\' (sodium) 0.5.8 with any version that is compatible with minecraft 1.21.10',
          '',
          'More details:'
        ].join('\n'))
        this.onClose(1)
      }, 1200)
    }
    return true
  }
}

module.exports = new Game()
module.exports.offlineUuid = offlineUuid
