// Простое общее состояние интерфейса с подпиской на изменения.
const listeners = new Set()

export const state = {
  info: null,
  settings: null,
  versions: null, // { latest, versions: [...] }
  versionsError: null,
  game: { state: 'idle' },
  stats: { byProfile: {}, totalMs: 0 },
  packs: [], // установленные сборки модов
  accounts: [], // аккаунты Ely.by (без токенов)
  tasks: {} // key -> { stage, current, total, done, error }
}

export function set (patch) {
  Object.assign(state, patch)
  for (const fn of listeners) fn(state, patch)
}

export function on (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const api = window.astra

export function profile () {
  return (state.settings && state.settings.profile) || { version: '', loader: 'vanilla' }
}

export function versionInfo (id) {
  return state.versions && state.versions.versions.find(v => v.id === id)
}

export function packInfo (id) {
  return (state.packs || []).find(x => x.id === id) || null
}

export function profileLabel (p = profile()) {
  if (!p.version) return 'Версия не выбрана'
  if (p.pack) {
    const pk = packInfo(p.pack)
    return pk ? `${pk.name} (${p.version})` : `Сборка (${p.version})`
  }
  return p.loader === 'fabric' ? `${p.version} + Fabric` : p.version
}

export function sameProfile (a, b) {
  return !!a && !!b && a.version === b.version && a.loader === b.loader && (a.pack || '') === (b.pack || '')
}

export async function refreshAccounts () {
  try { set({ accounts: await api.accounts.list() }) } catch {}
}

// Под каким именем сейчас играем: аккаунт Ely.by или ник.
export function activeAccount () {
  const id = state.settings && state.settings.account
  return id ? (state.accounts || []).find(a => a.id === id) || null : null
}

export function activeName () {
  const a = activeAccount()
  return a ? a.name : (state.settings && state.settings.nickname) || ''
}

export async function refreshPacks () {
  try { set({ packs: await api.packs.list() }) } catch {}
}

export async function selectProfile (p) {
  const settings = await api.selectProfile(p)
  // Ошибка прошлого запуска относится к другой версии — убираем её.
  if ((state.game.error || state.game.info) && state.game.state === 'idle') set({ game: { state: 'idle' } })
  set({ settings })
}

export async function refreshVersions () {
  try {
    const versions = await api.versions.list()
    set({ versions, versionsError: null })
    // Первый запуск: выбираем последнюю версию.
    if (!profile().version && versions.latest) {
      await selectProfile({ version: versions.latest.release, loader: 'vanilla' })
    }
  } catch (e) {
    set({ versionsError: e.message })
  }
}

export async function refreshStats () {
  try { set({ stats: await api.stats() }) } catch {}
}

export function playTime (ms) {
  const min = Math.round((ms || 0) / 60000)
  if (min < 1) return ''
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

export function statsFor (version) {
  const s = state.stats.byProfile || {}
  const a = s[`${version}|vanilla`] || {}
  const b = s[`${version}|fabric`] || {}
  return { playMs: (a.playMs || 0) + (b.playMs || 0), lastPlayed: Math.max(a.lastPlayed || 0, b.lastPlayed || 0) }
}

export function isGameBusy () {
  return state.game.state !== 'idle'
}
