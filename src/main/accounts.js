'use strict'
// Аккаунты Ely.by: вход по логину и паролю (протокол Yggdrasil), скины видят все
// на серверах с поддержкой Ely.by. Пароль не сохраняется — только токен доступа,
// зашифрованный средствами системы (на Windows — DPAPI через safeStorage).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app, safeStorage } = require('electron')
const { postJson } = require('./net')

const AUTH = 'https://authserver.ely.by/auth'
const file = () => path.join(app.getPath('userData'), 'accounts.json')

let cache = null

function load () {
  if (cache) return cache
  try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { cache = {} }
  if (!cache.clientToken) cache.clientToken = crypto.randomUUID().replace(/-/g, '')
  if (!Array.isArray(cache.accounts)) cache.accounts = []
  return cache
}

function save () {
  const tmp = file() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
  fs.renameSync(tmp, file())
}

function seal (token) {
  if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(token).toString('base64') }
  throw new Error('Защищённое хранилище недоступно. Вход Ely.by нельзя сохранить безопасно — проверь настройки системы.')
}

function unseal (t) {
  if (!t) return null
  if (t.enc) {
    try { return safeStorage.decryptString(Buffer.from(t.enc, 'base64')) } catch { return null }
  }
  return t.plain || null
}

// Для интерфейса — без токенов.
function list () {
  return load().accounts.map(a => ({ id: a.id, type: a.type, name: a.name, login: a.login }))
}

function errorText (res) {
  const msg = (res.data && res.data.errorMessage) || ''
  if (/two factor/i.test(msg)) return { need2fa: true, text: 'Аккаунт защищён двухфакторной проверкой — введи код из приложения' }
  if (/Invalid credentials/i.test(msg)) return { text: 'Неверный логин, пароль или код' }
  if (/blocked|banned/i.test(msg)) return { text: 'Аккаунт заблокирован на Ely.by' }
  if (res.status === 429) return { text: 'Слишком много попыток. Подожди пару минут' }
  return { text: msg || `Ely.by ответил ошибкой (${res.status})` }
}

/**
 * Вход. Если включена двухфакторная проверка, первый вызов вернёт { need2fa: true },
 * и нужно повторить с кодом (Ely.by принимает его как «пароль:код»).
 */
async function login ({ login, password, totp }) {
  login = String(login || '').trim()
  password = String(password || '')
  if (!login || !password) throw new Error('Введи логин и пароль')
  const res = await postJson(`${AUTH}/authenticate`, {
    username: login,
    password: totp ? `${password}:${String(totp).trim()}` : password,
    clientToken: load().clientToken,
    requestUser: true
  })
  if (!res.ok) {
    const err = errorText(res)
    if (err.need2fa && !totp) return { need2fa: true }
    throw new Error(err.text)
  }
  const p = res.data && res.data.selectedProfile
  if (!p || !p.id || !p.name) throw new Error('У аккаунта Ely.by нет игрового профиля')
  const all = load()
  all.accounts = all.accounts.filter(a => a.id !== p.id)
  all.accounts.push({ id: p.id, type: 'ely', name: p.name, login, token: seal(res.data.accessToken), addedAt: Date.now() })
  save()
  return { account: { id: p.id, type: 'ely', name: p.name, login } }
}

async function logout (id) {
  const all = load()
  const acc = all.accounts.find(a => a.id === id)
  if (!acc) return true
  const token = unseal(acc.token)
  if (token) {
    try { await postJson(`${AUTH}/invalidate`, { accessToken: token, clientToken: all.clientToken }) } catch {}
  }
  all.accounts = all.accounts.filter(a => a.id !== id)
  save()
  return true
}

/**
 * Данные для запуска игры. Перед каждым запуском обновляем токен.
 * Без интернета пробуем старый токен: одиночная игра всё равно запустится.
 */
async function launchAuth (id) {
  const all = load()
  const acc = all.accounts.find(a => a.id === id)
  if (!acc) throw new Error('Аккаунт Ely.by не найден — войди снова')
  let token = unseal(acc.token)
  if (!token) throw new Error('Не удалось прочитать данные входа Ely.by — войди снова')
  let offline = false
  try {
    const res = await postJson(`${AUTH}/refresh`, { accessToken: token, clientToken: all.clientToken, requestUser: false })
    if (res.ok && res.data && res.data.accessToken) {
      token = res.data.accessToken
      if (res.data.selectedProfile && res.data.selectedProfile.name) acc.name = res.data.selectedProfile.name
      acc.token = seal(token)
      save()
    } else if (res.status === 401 || res.status === 403 || res.status === 400) {
      throw new Error('Вход в Ely.by устарел — войди снова (нажми на ник внизу меню)')
    }
  } catch (e) {
    if (/устарел/.test(e.message)) throw e
    offline = true // нет связи с Ely.by — пробуем со старым токеном
  }
  return { name: acc.name, uuid: acc.id, accessToken: token, clientToken: all.clientToken, offline }
}

module.exports = { list, login, logout, launchAuth }
