'use strict'
// Статус в Discord («Играет в AstraLauncher»). Общение с приложением Discord идёт
// через локальный канал (named pipe), интернет не нужен. Если Discord не запущен — молча пропускаем.
const net = require('net')
const path = require('path')
const crypto = require('crypto')
const { DISCORD_CLIENT_ID } = require('./config')

const OP_HANDSHAKE = 0
const OP_FRAME = 1

function pipePath (i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp'
  return path.join(base, `discord-ipc-${i}`)
}

function encode (op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  return Buffer.concat([head, json])
}

function tryConnect (i) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(pipePath(i))
    const fail = e => { sock.destroy(); reject(e) }
    sock.once('connect', () => { sock.off('error', fail); resolve(sock) })
    sock.once('error', fail)
    setTimeout(() => fail(new Error('timeout')), 1500)
  })
}

class DiscordPresence {
  constructor () {
    this.sock = null
    this.ready = false
    this.pending = null
    this.connecting = null
  }

  async connect () {
    if (this.ready) return true
    if (this.connecting) return this.connecting
    this.connecting = (async () => {
      for (let i = 0; i < 10; i++) {
        try {
          const sock = await tryConnect(i)
          this.attach(sock)
          sock.write(encode(OP_HANDSHAKE, { v: 1, client_id: DISCORD_CLIENT_ID }))
          await new Promise((resolve, reject) => {
            this.onReady = resolve
            setTimeout(() => reject(new Error('Discord не ответил')), 3000)
          })
          return true
        } catch { this.close() }
      }
      return false
    })()
    try { return await this.connecting } finally { this.connecting = null }
  }

  attach (sock) {
    this.sock = sock
    let buf = Buffer.alloc(0)
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 8) {
        const len = buf.readInt32LE(4)
        if (buf.length < 8 + len) break
        let msg = null
        try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')) } catch {}
        buf = buf.subarray(8 + len)
        if (msg && msg.evt === 'READY') {
          this.ready = true
          if (this.onReady) this.onReady()
        }
      }
    })
    sock.on('close', () => { this.ready = false; this.sock = null })
    sock.on('error', () => {})
  }

  send (activity) {
    if (!this.sock || !this.ready) return false
    this.sock.write(encode(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: crypto.randomUUID()
    }))
    return true
  }

  // Показать игру: «Minecraft 1.21.4 + Fabric», с таймером.
  async playing ({ version, loader, startedAt }) {
    const activity = {
      details: `Minecraft ${version}${loader === 'fabric' ? ' + Fabric' : ''}`,
      state: 'В игре',
      timestamps: { start: Math.floor((startedAt || Date.now()) / 1000) },
      assets: { large_image: 'logo', large_text: 'AstraLauncher' },
      instance: false
    }
    this.pending = activity
    if (await this.connect().catch(() => false)) this.send(activity)
  }

  clear () {
    this.pending = null
    if (this.ready) {
      this.sock.write(encode(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: crypto.randomUUID() }))
    }
  }

  close () {
    this.ready = false
    if (this.sock) { try { this.sock.destroy() } catch {} }
    this.sock = null
  }
}

module.exports = new DiscordPresence()
