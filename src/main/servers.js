'use strict'
// Проверка серверов Minecraft по протоколу Server List Ping (1.7+):
// версия, онлайн, описание (MOTD), иконка и пинг. Учитываем DNS-записи SRV.
const net = require('net')
const dns = require('dns').promises

const ADDRESS_RE = /^[A-Za-z0-9.\-_]{1,253}(:\d{1,5})?$/

function parseAddress (addr) {
  const s = String(addr || '').trim()
  if (!ADDRESS_RE.test(s)) throw new Error('Адрес сервера выглядит неправильно')
  const [host, portStr] = s.split(':')
  const port = portStr ? Number(portStr) : 25565
  if (!(port > 0 && port < 65536)) throw new Error('Неправильный порт')
  return { host, port, explicitPort: !!portStr }
}

function varint (n) {
  const out = []
  let v = n >>> 0
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v) b |= 0x80
    out.push(b)
  } while (v)
  return Buffer.from(out)
}

function packet (id, ...parts) {
  const body = Buffer.concat([varint(id), ...parts])
  return Buffer.concat([varint(body.length), body])
}

function mcString (s) {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([varint(b.length), b])
}

// Читает varint из буфера: { value, size } или null, если данных пока мало.
function readVarint (buf, offset = 0) {
  let value = 0; let size = 0; let b
  do {
    if (offset + size >= buf.length) return null
    b = buf[offset + size]
    value |= (b & 0x7f) << (7 * size)
    size++
    if (size > 5) throw new Error('bad varint')
  } while (b & 0x80)
  return { value, size }
}

async function resolve ({ host, port, explicitPort }) {
  if (!explicitPort && !net.isIP(host)) {
    try {
      const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`)
      if (srv && srv[0]) return { host: srv[0].name, port: srv[0].port }
    } catch {}
  }
  return { host, port }
}

// Текст описания: строка или JSON-компонент с extra; убираем коды цвета §x.
function motdText (desc) {
  const walk = c => {
    if (c == null) return ''
    if (typeof c === 'string') return c
    let s = c.text || ''
    if (Array.isArray(c.extra)) s += c.extra.map(walk).join('')
    return s
  }
  return walk(desc).replace(/§[0-9a-fk-or]/gi, '').replace(/\s+\n/g, '\n').trim().slice(0, 300)
}

function mockPing (address) {
  // Режим разработки: правдоподобные ответы без сети.
  const h = [...address].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
  if (address.startsWith('down.')) return Promise.reject(new Error('Сервер выключен'))
  return new Promise(r => setTimeout(() => r({ latency: 20 + h % 180, version: ['Paper 1.21.4', 'Velocity 1.8-1.21', 'Fabric 1.20.1'][h % 3], protocol: 769, online: h % 300, max: 500, motd: ['Выживание без лицензии', 'Мини-игры каждый день', 'Ванильный сервер друзей'][h % 3], favicon: null }), 300 + h % 400))
}

function ping (address, timeout = 5000) {
  if (process.env.ASTRA_MOCK === '1') { try { parseAddress(address) } catch (e) { return Promise.reject(e) } return mockPing(address) }
  return new Promise((resolvePing, reject) => {
    let target
    try { target = parseAddress(address) } catch (e) { return reject(e) }
    resolve(target).then(({ host, port }) => {
      const sock = net.createConnection({ host, port })
      let buf = Buffer.alloc(0)
      let sentAt = 0
      let status = null
      const done = (err, val) => {
        clearTimeout(timer)
        sock.destroy()
        err ? reject(err) : resolvePing(val)
      }
      const timer = setTimeout(() => done(new Error('Сервер не отвечает')), timeout)
      sock.on('error', e => done(new Error(/ENOTFOUND|EAI_AGAIN/.test(e.code) ? 'Сервер не найден' : /ECONNREFUSED/.test(e.code) ? 'Сервер выключен' : 'Нет связи с сервером')))
      sock.on('connect', () => {
        const portBuf = Buffer.alloc(2)
        portBuf.writeUInt16BE(port)
        sock.write(packet(0x00, varint(767), mcString(target.host), portBuf, varint(1)))
        sock.write(packet(0x00))
        sentAt = Date.now()
      })
      sock.on('data', chunk => {
        buf = Buffer.concat([buf, chunk])
        try {
          while (true) {
            const len = readVarint(buf)
            if (!len || buf.length < len.size + len.value) return
            const pkt = buf.subarray(len.size, len.size + len.value)
            buf = buf.subarray(len.size + len.value)
            const id = readVarint(pkt)
            if (id.value === 0x00 && !status) {
              const sl = readVarint(pkt, id.size)
              const json = JSON.parse(pkt.subarray(id.size + sl.size, id.size + sl.size + sl.value).toString('utf8'))
              status = {
                latency: Date.now() - sentAt,
                version: json.version ? String(json.version.name || '').replace(/§[0-9a-fk-or]/gi, '').slice(0, 60) : '',
                protocol: json.version ? json.version.protocol : null,
                online: json.players ? json.players.online : null,
                max: json.players ? json.players.max : null,
                motd: motdText(json.description),
                favicon: typeof json.favicon === 'string' && json.favicon.startsWith('data:image/png;base64,') && json.favicon.length < 200000 ? json.favicon : null
              }
              // Точный пинг: отправляем ping-пакет и ждём ответа.
              const payload = Buffer.alloc(8)
              payload.writeBigInt64BE(BigInt(Date.now()))
              sentAt = Date.now()
              sock.write(packet(0x01, payload))
            } else if (id.value === 0x01 && status) {
              status.latency = Date.now() - sentAt
              return done(null, status)
            }
          }
        } catch (e) {
          done(new Error('Сервер ответил непонятно'))
        }
      })
      // Некоторые серверы не отвечают на ping-пакет — тогда хватает статуса.
      sock.on('close', () => { if (status) done(null, status) })
    }).catch(reject)
  })
}

module.exports = { ping, parseAddress, ADDRESS_RE }
