'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable, Transform } = require('stream')
const { pipeline } = require('stream/promises')
const { net } = require('electron')
const pkg = require('../../package.json')

const USER_AGENT = `AstraLauncher/${pkg.version} (github.com/astralauncher)`

// Лаунчер ходит только сюда. Всё остальное — отказ.
const ALLOWED_HOSTS = new Set([
  'piston-meta.mojang.com',
  'launchermeta.mojang.com',
  'piston-data.mojang.com',
  'launcher.mojang.com',
  'libraries.minecraft.net',
  'resources.download.minecraft.net',
  'api.modrinth.com',
  'cdn.modrinth.com',
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'api.adoptium.net',
  'github.com',
  'authserver.ely.by',
  'authlib-injector.yushi.moe',
  'raw.githubusercontent.com',
  'gitlab.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

const MOCK = process.env.ASTRA_MOCK === '1'
let mock = null
if (MOCK) mock = require('../../dev/mock')

function checkUrl (url) {
  let u
  try { u = new URL(url) } catch { throw new Error('Некорректный адрес: ' + url) }
  if (u.protocol !== 'https:') throw new Error('Разрешён только https: ' + url)
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error('Хост не в списке доверенных: ' + u.hostname)
  return u
}

function friendlyError (err, url) {
  const host = (() => { try { return new URL(url).hostname } catch { return url } })()
  const msg = String(err && err.message || err)
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(msg)) {
    return new Error(`Нет связи с ${host}. Проверь интернет.`)
  }
  if (/ERR_TIMED_OUT|timeout|aborted/i.test(msg)) {
    return new Error(`${host} не ответил вовремя. Попробуй ещё раз.`)
  }
  return err instanceof Error ? err : new Error(msg)
}

// Активные загрузки по группам: «Отменить запуск» обрывает только загрузки игры,
// а установка модов в это время продолжается.
const active = new Set()

function abortAll (group = 'game') {
  for (const c of active) if (c.group === group) c.abort()
}

async function request (url, { timeout = 20000, ctrl = new AbortController() } = {}) {
  checkUrl(url)
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: ctrl.signal,
      redirect: 'follow'
    })
    // После редиректов адрес тоже должен быть доверенным.
    if (res.url && res.url !== url) checkUrl(res.url)
    if (!res.ok) throw new Error(`Сервер ответил ${res.status} (${new URL(url).hostname})`)
    return res
  } catch (e) {
    throw friendlyError(e, url)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson (url, opts = {}) {
  if (MOCK) return mock.json(url)
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(url, opts)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (/ответил 4\d\d|не в списке|только https/.test(e.message)) break // повторять бессмысленно
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  throw lastErr
}

// POST с JSON. Не бросает ошибку на 4xx — вызывающий сам разбирает ответ сервера.
async function postJson (url, body, { timeout = 20000 } = {}) {
  if (MOCK) return mock.post(url, body)
  checkUrl(url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch {}
    return { status: res.status, ok: res.ok, data }
  } catch (e) {
    throw friendlyError(e, url)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Скачивает файл во временный, проверяет хеш, затем переименовывает.
 * hash: { algo: 'sha1'|'sha256'|'sha512', value }
 * Если 30 секунд не пришло ни байта — загрузка обрывается с понятной ошибкой.
 */
async function download (url, dest, { hash, onProgress, idle = 30000, group = 'game' } = {}) {
  const ctrl = new AbortController()
  ctrl.group = group
  if (MOCK) {
    active.add(ctrl)
    try { return await mock.download(url, dest, onProgress, ctrl.signal) } finally { active.delete(ctrl) }
  }
  active.add(ctrl)
  let stalled = false
  let idleTimer = null
  const kick = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { stalled = true; ctrl.abort() }, idle)
  }
  // Уникальное временное имя: две одновременные загрузки одного файла не мешают друг другу.
  const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`
  try {
    const res = await request(url, { timeout: 60000, ctrl })
    const total = Number(res.headers.get('content-length')) || 0
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const hasher = hash ? crypto.createHash(hash.algo) : null
    let received = 0
    let lastEmit = 0
    const counter = new Transform({
      transform (chunk, _enc, cb) {
        kick()
        received += chunk.length
        if (hasher) hasher.update(chunk)
        const now = Date.now()
        if (onProgress && (now - lastEmit > 120 || received === total)) {
          lastEmit = now
          onProgress(received, total)
        }
        cb(null, chunk)
      }
    })
    kick()
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp), { signal: ctrl.signal })
    if (hasher) {
      const got = hasher.digest('hex')
      if (got.toLowerCase() !== String(hash.value).toLowerCase()) {
        throw new Error('Файл скачался повреждённым (не совпал хеш). Попробуй ещё раз.')
      }
    }
    fs.renameSync(tmp, dest)
    if (onProgress) onProgress(received, total || received)
    return dest
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    if (stalled) throw new Error(`${new URL(url).hostname} перестал отвечать. Попробуй ещё раз.`)
    if (ctrl.signal.aborted) throw new Error('Загрузка отменена')
    throw friendlyError(e, url)
  } finally {
    clearTimeout(idleTimer)
    active.delete(ctrl)
  }
}

module.exports = { fetchJson, postJson, download, abortAll, USER_AGENT, MOCK, ALLOWED_HOSTS }
