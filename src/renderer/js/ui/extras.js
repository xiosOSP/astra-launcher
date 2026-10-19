// Переключатель ников, обновление лаунчера и окно «Почему игра закрылась».
import { icon } from './icons.js'
import { esc, $, modal, popupMenu, toast } from './dom.js'
import { avatarSvg } from '../art/blocks.js'
import { state, set, api } from '../store.js'
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
    const settings = await api.settings.set({ nickname: nick })
    set({ settings })
    toast(`Теперь ты ${nick}`)
  } catch (e) { toast(e.message, 'err') }
}

export function openNickMenu (anchor) {
  const s = state.settings
  const nicks = s.nicknames && s.nicknames.length ? s.nicknames : [s.nickname].filter(Boolean)
  const markup = `
    <div class="menu-group">Ники</div>
    ${nicks.map(n => `<button class="menu-item" role="menuitemradio" aria-checked="${n === s.nickname}" data-nick="${esc(n)}">
      <span class="menu-avatar">${avatarSvg(n)}</span><span>${esc(n)}</span>
      <span class="meta">${n === s.nickname ? icon('check', 16) : ''}</span></button>`).join('')}
    <div class="menu-sep"></div>
    ${nicks.length < 10 ? `<button class="menu-item" data-add>${icon('user-plus', 16)} Добавить ник</button>` : ''}
    <button class="menu-item" data-manage>${icon('settings', 16)} Настройки игрока</button>`
  popupMenu(anchor, markup, {
    align: 'left',
    onReady (menu, close) {
      menu.addEventListener('click', async e => {
        const b = e.target.closest('.menu-item')
        if (!b) return
        close()
        if (b.dataset.nick && b.dataset.nick !== state.settings.nickname) return switchNick(b.dataset.nick)
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
    const text = upd.status === 'downloading' ? `Скачиваю ${upd.version || ''} · ${upd.percent || 0}%` : upd.status === 'ready' ? 'Обновление готово' : `Доступна версия ${upd.version}`
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
    <h2>AstraLauncher ${esc(upd.version || '')}</h2>
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
  if (c.actions.includes('mods')) actions.push(`<button class="btn" data-a="mods">${icon('puzzle', 16)}Открыть моды</button>`)
  if (c.reportFile) actions.push(`<button class="btn ghost" data-a="report">${icon('bug', 16)}Отчёт о вылете</button>`)
  actions.push(`<button class="btn ghost" data-a="log">${icon('terminal', 16)}Лог</button>`)
  const m = modal(`
    <div class="crash-head">${icon('triangle-alert', 28)}<div><h2>${esc(c.title)}</h2><p>${esc(c.text)}</p></div></div>
    ${c.details && c.details.length ? `<ul class="crash-details">${c.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    <div class="modal-actions wrap">${actions.join('')}<button class="btn primary" data-close>Понятно</button></div>`)
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]')
    if (!b) return
    const a = b.dataset.a
    if (a === 'report') return api.shell.openReport(c.reportFile).catch(err => toast(err.message, 'err'))
    m.close()
    if (a === 'settings') go('settings')
    if (a === 'mods') {
      if (p && p.version) await (await import('../store.js')).selectProfile(p)
      go('mods', { tab: 'installed' })
    }
    if (a === 'log') document.getElementById('btn-log').click()
  })
}
