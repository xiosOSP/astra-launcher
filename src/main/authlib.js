'use strict'
// authlib-injector — агент Java, который направляет проверку входа и скины игры
// на Ely.by. Скачиваем его один раз с проверкой SHA-256 и обновляем, когда выходит новая версия.
const fs = require('fs')
const path = require('path')
const { fetchJson, download, MOCK } = require('./net')
const settings = require('./settings')

const LATEST = 'https://authlib-injector.yushi.moe/artifact/latest.json'

function dir () {
  return path.join(settings.gameDir(), 'runtime', 'authlib-injector')
}

function localJar () {
  try {
    return fs.readdirSync(dir()).filter(f => /^authlib-injector-[\d.]+\.jar$/.test(f)).sort().map(f => path.join(dir(), f)).pop() || null
  } catch { return null }
}

async function ensure (onStatus = () => {}) {
  if (MOCK) {
    fs.mkdirSync(dir(), { recursive: true })
    const p = path.join(dir(), 'authlib-injector-1.2.8.jar')
    if (!fs.existsSync(p)) fs.writeFileSync(p, 'mock')
    return p
  }
  let latest
  try {
    latest = await fetchJson(LATEST)
  } catch (e) {
    const have = localJar()
    if (have) return have // без интернета — тем, что уже есть
    throw new Error('Не удалось скачать authlib-injector для Ely.by: ' + e.message)
  }
  if (!latest || !/^[\d.]+$/.test(String(latest.version)) || !latest.download_url || !latest.checksums || !latest.checksums.sha256) {
    const have = localJar()
    if (have) return have
    throw new Error('authlib-injector: неожиданный ответ сервера')
  }
  const target = path.join(dir(), `authlib-injector-${latest.version}.jar`)
  if (!fs.existsSync(target)) {
    onStatus({ stage: 'Скачиваю authlib-injector для Ely.by' })
    await download(latest.download_url, target, { hash: { algo: 'sha256', value: latest.checksums.sha256 } })
    // старые версии больше не нужны
    for (const f of fs.readdirSync(dir())) {
      if (f !== path.basename(target) && f.startsWith('authlib-injector-')) fs.rmSync(path.join(dir(), f), { force: true })
    }
  }
  return target
}

module.exports = { ensure }
