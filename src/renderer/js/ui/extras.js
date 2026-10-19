// Переключатель ников, обновление лаунчера и окно «Почему игра закрылась».
import { icon } from './icons.js'
import { esc, $, modal, popupMenu, toast } from './dom.js'
import { avatarHtml } from '../art/blocks.js'
import { state, set, api, refreshAccounts } from '../store.js'
import { go } from '../router.js'

const NICK_RE = /^[A-Za-z0-9_]{3,16}$/

// ---------- ники ----------
export function addNickDialog ({ title = 'Новый ник', first = false } = {}) {
  return new Promise(resolve => {
    let done = false
    const m = modal(`
      <h2>${esc(title)}</h2>
      <p>Под этим ником ты будешь в игре. ${first ? 'Потом можно добавить ещё.' : 'Миры привязаны к нику: у нового ника в старых мирах будет пустой инвентарь.'}</p>
      <div class="field">
        <label class="label" for="nn">Ник</label>
        <input class="input" id="nn" maxlength="16" placeholder="Например, Dobe" autocomplete="off" spellcheck="false" autofocus>
        <div class="hint" id="nn-hint">От 3 до 16 символов: латиница, цифры и _</div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="nn-ok" disabled>Добавить</button>
      </div>`, { onClose: () => { if (!done) resolve(null) } })
    const input = $('#nn', m.el); const ok = $('#nn-ok', m.el)
    const valid = () => NICK_RE.test(input.value) && !(state.settings.nicknames || []).includes(input.value)
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^A-Za-z0-9_]/g, '')
      ok.disabled = !valid()
      $('#nn-hint', m.el).textContent = (state.settings.nicknames || []).includes(input.value) ? 'Такой ник уже есть' : 'От 3 до 16 символов: латиница, цифры и _'
    })
    const submit = async () => {
      if (!valid()) return
      try {
        const settings = await api.settings.set({ nickname: input.value, nicknames: [...(state.settings.nicknames || []), input.value] })
        set({ settings })
        done = true
        m.close()
        resolve(input.value)
      } catch (e) { $('#nn-hint', m.el).textContent = e.message }
    }
    ok.onclick = submit
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
  })
}

export async function switchNick (nick) {
  if (state.game.state !== 'idle') { toast('Ник можно сменить, когда игра закрыта', 'err'); return }
  try {
    const settings = await api.settings.set({ nickname: nick, account: '' })
    set({ settings })
    toast(`Теперь ты ${nick}`)
  } catch (e) { toast(e.message, 'err') }
}

export async function switchAccount (id) {
  if (state.game.state !== 'idle') { toast('Аккаунт можно сменить, когда игра закрыта', 'err'); return }
  const acc = (state.accounts || []).find(a => a.id === id)
  try {
    const settings = await api.settings.set({ account: id })
    set({ settings })
    if (acc) toast(`Теперь ты ${acc.name} (Ely.by)`)
  } catch (e) { toast(e.message, 'err') }
}

// Вход в Ely.by. Пароль никуда не сохраняется — только токен, зашифрованный системой.
export function elyLoginDialog () {
  return new Promise(resolve => {
    let done = false
    const m = modal(`
      <h2>Вход через Ely.by</h2>
      <p>Ely.by — бесплатные аккаунты со скинами. Скин видят все на серверах с поддержкой Ely.by.
        Нет аккаунта? <button class="section-link" id="ely-reg" style="display:inline-flex;margin:0">Зарегистрироваться на ely.by</button></p>
      <div class="field"><label class="label" for="ely-login">Ник или почта</label>
        <input class="input" id="ely-login" autocomplete="username" spellcheck="false" autofocus></div>
      <div class="field" style="margin-top:12px"><label class="label" for="ely-pass">Пароль</label>
        <input class="input" id="ely-pass" type="password" autocomplete="current-password"></div>
      <div class="field" id="ely-2fa-box" style="margin-top:12px" hidden><label class="label" for="ely-2fa">Код из приложения</label>
        <input class="input" id="ely-2fa" inputmode="numeric" maxlength="8" autocomplete="one-time-code"></div>
      <div class="hint" id="ely-hint" style="margin-top:10px">Пароль не сохраняется.</div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="ely-ok">Войти</button>
      </div>`, { onClose: () => { if (!done) resolve(null) } })
    const hint = $('#ely-hint', m.el)
    const btn = $('#ely-ok', m.el)
    $('#ely-reg', m.el).onclick = () => api.shell.openExternal('https://account.ely.by/register')
    const submit = async () => {
      const box2fa = $('#ely-2fa-box', m.el)
      btn.disabled = true
      btn.innerHTML = `${icon('loader-circle', 16).replace('<svg ', '<svg class="spin" ')}Вхожу…`
      hint.classList.remove('warn')
      try {
        const res = await api.accounts.login({
          login: $('#ely-login', m.el).value,
          password: $('#ely-pass', m.el).value,
          totp: box2fa.hidden ? undefined : $('#ely-2fa', m.el).value
        })
        if (res.need2fa) {
          box2fa.hidden = false
          hint.textContent = 'Аккаунт защищён двухфакторной проверкой — введи код из приложения.'
          $('#ely-2fa', m.el).focus()
        } else {
          await refreshAccounts()
          const settings = await api.settings.set({ account: res.account.id })
          set({ settings })
          done = true
          m.close()
          toast(`Вошёл как ${res.account.name} (Ely.by)`)
          resolve(res.account)
          return
        }
      } catch (e) {
        hint.textContent = e.message
        hint.classList.add('warn')
      }
      btn.disabled = false
      btn.textContent = 'Войти'
    }
    btn.onclick = submit
    m.el.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
  })
}

export function openNickMenu (anchor) {
  const s = state.settings
  const nicks = s.nicknames && s.nicknames.length ? s.nicknames : [s.nickname].filter(Boolean)
  const accs = state.accounts || []
  const markup = `
    <div class="menu-group">Ники</div>
    ${nicks.map(n => { const on = !s.account && n === s.nickname; return `<button class="menu-item" role="menuitemradio" aria-checked="${on}" data-nick="${esc(n)}">
      <span class="menu-avatar">${avatarHtml(n)}</span><span>${esc(n)}</span>
      <span class="meta">${on ? icon('check', 16) : ''}</span></button>` }).join('')}
    ${accs.length ? `<div class="menu-group">Ely.by</div>${accs.map(a => { const on = s.account === a.id; return `<button class="menu-item" role="menuitemradio" aria-checked="${on}" data-acc="${esc(a.id)}">
      <span class="menu-avatar">${avatarHtml(a.name, true)}</span><span>${esc(a.name)}</span>
      <span class="meta">${on ? icon('check', 16) : '<span class="chip">Ely.by</span>'}</span></button>` }).join('')}` : ''}
    <div class="menu-sep"></div>
    ${nicks.length < 10 ? `<button class="menu-item" data-add>${icon('user-plus', 16)} Добавить ник</button>` : ''}
    <button class="menu-item" data-ely>${icon('shield-check', 16)} Войти через Ely.by (скины)</button>
    <button class="menu-item" data-manage>${icon('settings', 16)} Настройки игрока</button>`
  popupMenu(anchor, markup, {
    align: 'left',
    onReady (menu, close) {
      menu.addEventListener('click', async e => {
        const b = e.target.closest('.menu-item')
        if (!b) return
        close()
        if (b.dataset.nick && (b.dataset.nick !== state.settings.nickname || state.settings.account)) return switchNick(b.dataset.nick)
        if (b.dataset.acc && b.dataset.acc !== state.settings.account) return switchAccount(b.dataset.acc)
        if (b.dataset.ely !== undefined) return elyLoginDialog()
        if (b.dataset.add !== undefined) {
          const n = await addNickDialog()
          if (n) toast(`Ник ${n} добавлен и выбран`)
        }
        if (b.dataset.manage !== undefined) go('settings')
      })
    }
  })
}

// ---------- обновление ----------
let upd = { status: 'idle' }
let updModal = null

export function initUpdates () {
  api.update.state().then(paintUpdateSlot).catch(() => {})
  api.on('update:status', st => {
    paintUpdateSlot(st)
    if (updModal) updModal.paint()
  })
}

function paintUpdateSlot (st) {
  upd = st || upd
  const slot = $('#update-slot')
  if (!slot) return
  if (['available', 'downloading', 'ready'].includes(upd.status)) {
    const text = upd.status === 'downloading' ? `Скачиваю ${upd.versionLabel || upd.version || ''} · ${upd.percent || 0}%` : upd.status === 'ready' ? 'Обновление готово' : `Доступна версия ${upd.versionLabel || upd.version}`
    slot.innerHTML = `<button class="update-badge" id="upd-open">${icon('circle-arrow-up', 18)}<span><b>${esc(text)}</b><small>${upd.status === 'ready' ? 'Нажми, чтобы перезапустить' : 'Нажми, чтобы посмотреть'}</small></span></button>`
    $('#upd-open', slot).onclick = openUpdateModal
  } else {
    slot.innerHTML = ''
  }
  window.dispatchEvent(new CustomEvent('astra:update', { detail: upd }))
}

export function getUpdateState () { return upd }

export function openUpdateModal () {
  const m = modal(`
    <h2>AstraLauncher ${esc(upd.versionLabel || upd.version || '')}</h2>
    <p class="hint" style="margin-top:-4px">Сейчас у тебя ${esc(state.info.version)}</p>
    <pre class="notes" id="upd-notes"></pre>
    <div class="upd-progress" id="upd-prog" hidden><div class="bar"><i></i></div><span></span></div>
    <div class="modal-actions" id="upd-actions"></div>`, { onClose: () => { updModal = null } })
  $('#upd-notes', m.el).textContent = upd.notes || 'Исправления и улучшения.'
  const paint = () => {
    const prog = $('#upd-prog', m.el)
    const act = $('#upd-actions', m.el)
    prog.hidden = upd.status !== 'downloading'
    if (upd.status === 'downloading') {
      prog.querySelector('i').style.width = (upd.percent || 0) + '%'
      prog.querySelector('span').textContent = `Скачиваю… ${upd.percent || 0}%`
    }
    if (upd.status === 'available') {
      act.innerHTML = upd.canInstall
        ? `<button class="btn ghost" data-close>Позже</button><button class="btn primary" id="upd-go">${icon('download', 16)}Скачать и обновить</button>`
        : `<button class="btn ghost" data-close>Позже</button><button class="btn primary" id="upd-page">${icon('external-link', 16)}Открыть страницу загрузки</button>`
    } else if (upd.status === 'downloading') {
      act.innerHTML = '<button class="btn ghost" data-close>Скрыть</button>'
    } else if (upd.status === 'ready') {
      act.innerHTML = `<button class="btn ghost" data-close>Позже</button><button class="btn primary" id="upd-restart">${icon('refresh-cw', 16)}Перезапустить</button>`
    } else if (upd.status === 'error') {
      act.innerHTML = `<span class="hint warn" style="margin-right:auto">${esc(upd.error || '')}</span><button class="btn ghost" data-close>Закрыть</button><button class="btn" id="upd-page">Скачать вручную</button>`
    }
    act.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => m.close() })
    const go2 = $('#upd-go', act); if (go2) go2.onclick = () => api.update.download().catch(e => toast(e.message, 'err'))
    const pg = $('#upd-page', act); if (pg) pg.onclick = () => api.update.openPage()
    const rs = $('#upd-restart', act)
    if (rs) rs.onclick = async () => {
      try {
        const ok = await api.update.install()
        if (!ok) toast('В тестовом режиме перезапуск пропущен', 'info')
      } catch (e) { toast(e.message, 'err') }
    }
  }
  updModal = { paint }
  paint()
}

// ---------- вылет ----------
export function showCrash (st) {
  const c = st.crash
  if (!c) { toast(st.error, 'err', 7000); return }
  const p = st.profile
  const actions = []
  if (c.actions.includes('settings')) actions.push(`<button class="btn" data-a="settings">${icon('settings', 16)}Открыть настройки</button>`)
  if (c.actions.includes('rollback')) actions.push(`<button class="btn primary" data-a="rollback">${icon('undo-2', 16)}Вернуть моды до обновления</button>`)
  if (c.actions.includes('mods')) actions.push(`<button class="btn" data-a="mods">${icon('puzzle', 16)}Открыть моды</button>`)
  if (c.reportFile) actions.push(`<button class="btn ghost" data-a="report">${icon('bug', 16)}Отчёт о вылете</button>`)
  actions.push(`<button class="btn ghost" data-a="log">${icon('terminal', 16)}Лог</button>`)
  const m = modal(`
    <div class="crash-head">${icon('triangle-alert', 28)}<div><h2>${esc(c.title)}</h2><p>${esc(c.text)}</p></div></div>
    ${c.rollback ? `<p class="hint">Перед этим запуском ты обновил моды${c.rollback.titles && c.rollback.titles.length ? ` (${esc(c.rollback.titles.slice(0, 4).join(', '))}${c.rollback.titles.length > 4 ? ' и другие' : ''})` : ''}. Если раньше всё работало — верни их как было.</p>` : ''}
    ${c.details && c.details.length ? `<ul class="crash-details">${c.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    <div class="modal-actions wrap">${actions.join('')}<button class="btn ${c.actions.includes('rollback') ? '' : 'primary'}" data-close>Понятно</button></div>`)
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]')
    if (!b) return
    const a = b.dataset.a
    if (a === 'report') return api.shell.openReport(c.reportFile).catch(err => toast(err.message, 'err'))
    if (a === 'rollback') {
      try {
        await api.content.rollback({ profile: p, type: 'mod' })
        toast('Моды возвращены как были до обновления. Можно играть!')
        m.close()
      } catch (err) { toast(err.message, 'err') }
      return
    }
    m.close()
    if (a === 'settings') go('settings')
    if (a === 'mods') {
      if (p && p.version) await (await import('../store.js')).selectProfile(p)
      go('mods', { sub: 'mod', tab: 'installed' })
    }
    if (a === 'log') document.getElementById('btn-log').click()
  })
}
