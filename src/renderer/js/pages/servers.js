// Раздел «Сервера»: свои сервера с онлайном и пингом, вход на сервер в один клик.
import { icon } from '../ui/icons.js'
import { esc, $, modal, toast, confirmDialog } from '../ui/dom.js'
import { blockSvg } from '../art/blocks.js'
import { state, set, on, api, profile, profileLabel } from '../store.js'
import { go } from '../router.js'
import { launchChecked } from '../ui/tools.js'

const ADDRESS_RE = /^[A-Za-z0-9.\-_]{1,253}(:\d{1,5})?$/

function signal (ms) {
  const bars = ms == null ? 0 : ms < 80 ? 4 : ms < 150 ? 3 : ms < 300 ? 2 : 1
  return `<span class="signal s${bars}" title="${ms == null ? '' : ms + ' мс'}">${[1, 2, 3, 4].map(i => `<i class="${i <= bars ? 'on' : ''}"></i>`).join('')}</span>`
}

export function render (root) {
  const status = {} // address -> { loading, data, error }
  let timer = 0

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Сервера</h1>
        <p class="page-sub">Добавь сервер — лаунчер покажет онлайн и пинг, а «Играть» сразу зайдёт на него.</p>
      </div>
      <div class="actions">
        <button class="btn btn-icon" id="s-refresh" title="Обновить">${icon('refresh-cw', 17)}</button>
        <button class="btn primary" id="s-add">${icon('plus', 16)}Добавить сервер</button>
      </div>
    </div>
    <p class="hint" style="margin:-8px 0 16px">${icon('info', 14)} Вход по нику работает на серверах без проверки лицензии. Сервера с лицензией (например, Hypixel) такой ник не пустят.</p>
    <div id="s-body"></div>`
  const body = $('#s-body', root)

  const list = () => state.settings.servers || []

  function card (s, i) {
    const st = status[s.address] || {}
    const d = st.data
    const icon64 = d && d.favicon ? `<img src="${esc(d.favicon)}" alt="">` : blockSvg('stone', s.address.length * 7)
    let line
    if (st.loading && !d) line = '<span class="muted">Проверяю…</span>'
    else if (st.error) line = `<span class="off">${icon('wifi-off', 14)}${esc(st.error)}</span>`
    else if (d) line = `<span class="on">${d.online != null ? `${d.online} / ${d.max} игроков` : 'Онлайн'}</span>${d.version ? `<span class="chip">${esc(d.version)}</span>` : ''}`
    else line = ''
    return `<section class="server" data-i="${i}">
      <div class="server-icon">${icon64}</div>
      <div class="row-main">
        <div class="row-title">${esc(s.name)} <span class="author">${esc(s.address)}</span></div>
        ${d && d.motd ? `<div class="motd">${esc(d.motd)}</div>` : ''}
        <div class="server-line">${line}</div>
      </div>
      <div class="server-ping">${signal(d && !st.error ? d.latency : null)}<span>${d && !st.error ? d.latency + ' мс' : ''}</span></div>
      <div class="row-actions">
        <button class="btn sm btn-icon" data-edit="${i}" title="Изменить">${icon('pencil', 15)}</button>
        <button class="btn sm btn-icon danger" data-del="${i}" title="Удалить">${icon('trash-2', 15)}</button>
        <button class="btn sm primary" data-join="${i}" ${state.game.state !== 'idle' ? 'disabled' : ''}>${icon('play', 15)}Играть</button>
      </div>
    </section>`
  }

  function paint () {
    const items = list()
    if (!items.length) {
      body.innerHTML = `<div class="empty">${blockSvg('stone', 4)}<h3>Серверов пока нет</h3><p>Добавь адрес сервера, например <b>mc.example.ru</b> или <b>play.server.net:25566</b>.</p><button class="btn primary" data-add-empty>${icon('plus', 16)}Добавить сервер</button></div>`
      return
    }
    body.innerHTML = `<div class="servers">${items.map(card).join('')}</div>
      <p class="hint" style="margin-top:12px">Играть будешь на версии, выбранной сейчас: <b>${esc(profileLabel(profile()))}</b>. Если сервер на другой версии — смени её на главной.</p>`
  }

  async function pingOne (address) {
    status[address] = { ...(status[address] || {}), loading: true }
    paint()
    try {
      const data = await api.servers.ping(address)
      status[address] = { data }
    } catch (e) {
      status[address] = { error: e.message }
    }
    paint()
  }

  function pingAll () {
    for (const s of list()) pingOne(s.address)
  }

  async function saveServers (servers) {
    try {
      const settings = await api.settings.set({ servers })
      set({ settings })
      return true
    } catch (e) { toast(e.message, 'err'); return false }
  }

  function editDialog (index = -1) {
    const cur = index >= 0 ? list()[index] : { name: '', address: '' }
    const m = modal(`
      <h2>${index >= 0 ? 'Изменить сервер' : 'Новый сервер'}</h2>
      <div class="field"><label class="label" for="sv-name">Название</label>
        <input class="input" id="sv-name" maxlength="40" value="${esc(cur.name)}" placeholder="Например, Сервер друзей" autocomplete="off"></div>
      <div class="field" style="margin-top:12px"><label class="label" for="sv-addr">Адрес</label>
        <input class="input" id="sv-addr" maxlength="260" value="${esc(cur.address)}" placeholder="mc.example.ru или 1.2.3.4:25565" autocomplete="off" spellcheck="false" ${index < 0 ? 'autofocus' : ''}>
        <div class="hint" id="sv-hint">Порт можно не указывать, если он стандартный (25565).</div></div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="sv-ok">${index >= 0 ? 'Сохранить' : 'Добавить'}</button>
      </div>`)
    const addr = $('#sv-addr', m.el)
    const submit = async () => {
      const address = addr.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
      if (!ADDRESS_RE.test(address)) { $('#sv-hint', m.el).textContent = 'Адрес выглядит неправильно: только латиница, цифры, точки и порт через двоеточие.'; addr.classList.add('invalid'); return }
      const name = $('#sv-name', m.el).value.trim() || address
      const servers = [...list()]
      if (index >= 0) servers[index] = { name, address }
      else {
        if (servers.some(s => s.address === address)) { $('#sv-hint', m.el).textContent = 'Такой сервер уже есть в списке.'; return }
        servers.push({ name, address })
      }
      if (await saveServers(servers)) { m.close(); paint(); pingOne(address) }
    }
    $('#sv-ok', m.el).onclick = submit
    m.el.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
  }

  root.addEventListener('click', async e => {
    const t = e.target
    if (t.closest('#s-add') || t.closest('[data-add-empty]')) return editDialog()
    if (t.closest('#s-refresh')) return pingAll()
    const ed = t.closest('[data-edit]')
    if (ed) return editDialog(Number(ed.dataset.edit))
    const del = t.closest('[data-del]')
    if (del) {
      const s = list()[Number(del.dataset.del)]
      if (!s) return
      const ok = await confirmDialog({ title: `Удалить «${s.name}»?`, text: 'Сервер пропадёт из списка. Его всегда можно добавить снова.' })
      if (ok && await saveServers(list().filter((_, i) => i !== Number(del.dataset.del)))) paint()
      return
    }
    const j = t.closest('[data-join]')
    if (j) {
      const s = list()[Number(j.dataset.join)]
      if (!s) return
      if (!state.settings.nickname) { toast('Сначала укажи ник', 'err'); return }
      go('home')
      await launchChecked(profile(), { server: s.address })
    }
  })

  paint()
  pingAll()
  // Обновляем онлайн раз в минуту, пока открыт раздел.
  timer = setInterval(pingAll, 60000)
  const off = on((_s, patch) => { if ('settings' in patch || 'game' in patch) paint() })
  return () => { clearInterval(timer); off() }
}
