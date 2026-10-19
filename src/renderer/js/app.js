import { icon } from './ui/icons.js'
import { esc, $, modal, toast } from './ui/dom.js'
import { starSvg, avatarSvg } from './art/blocks.js'
import { state, set, on, api, refreshVersions, refreshStats, refreshPacks, profileLabel } from './store.js'
import { register, go, onRoute } from './router.js'
import * as home from './pages/home.js'
import * as versions from './pages/versions.js'
import * as content from './pages/content.js'
import * as shots from './pages/shots.js'
import * as settingsPage from './pages/settings.js'
import * as worldsPage from './pages/worlds.js'
import * as modpacksPage from './pages/modpacks.js'
import * as serversPage from './pages/servers.js'
import { openNickMenu, initUpdates, showCrash } from './ui/extras.js'

register('home', home)
register('versions', versions)
register('mods', { render: (root, p) => content.render(root, { ...p, type: 'mod' }) })
register('packs', { render: (root, p) => content.render(root, { ...p, type: 'resourcepack' }) })
register('shots', shots)
register('worlds', worldsPage)
register('modpacks', modpacksPage)
register('servers', serversPage)
register('shaders', { render: (root, p) => content.render(root, { ...p, type: 'shader' }) })
register('settings', settingsPage)

const NAV = [
  ['home', 'house', 'Главная'],
  ['versions', 'gamepad-2', 'Версии'],
  ['modpacks', 'package-plus', 'Сборки'],
  ['mods', 'puzzle', 'Моды'],
  ['packs', 'layers', 'Ресурспаки'],
  ['shaders', 'sun', 'Шейдеры'],
  ['worlds', 'globe', 'Миры'],
  ['servers', 'server', 'Сервера'],
  ['shots', 'camera', 'Скриншоты'],
  ['settings', 'settings', 'Настройки']
]

const TIPS = [
  'Нажми <strong>F2</strong> в игре — снимок появится в разделе «Скриншоты».',
  'У каждой версии своя папка: моды и миры <strong>1.20.1</strong> не смешаются с <strong>1.21</strong>.',
  'Java ставится сама — нужная версия под каждую игру.',
  'Тормозит? Кнопка <strong>«Ускорить игру»</strong> на главной поставит Fabric и Sodium.',
  'Скачанные версии запускаются и без интернета.',
  'После каждой игры лаунчер сам сохраняет копии миров — смотри раздел <strong>«Миры»</strong>.',
  'Нажми на свой ник внизу, чтобы переключиться на другой или добавить новый.'
]

// ---------- каркас ----------
function renderShell () {
  $('#brand').innerHTML = `${starSvg(38)}<div><div class="brand-name">ASTRA</div><div class="brand-sub">launcher</div></div>`
  $('#nav').innerHTML = NAV.map(([id, ic, label]) =>
    `<button class="nav-item" data-route="${id}">${icon(ic, 21)}<span>${label}</span></button>`).join('')
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('[data-route]')
    if (b) go(b.dataset.route)
  })
  $('#tip').innerHTML = TIPS[Math.floor(Math.random() * TIPS.length)]

  $('#btn-log').innerHTML = icon('terminal', 17)
  $('#btn-min').innerHTML = icon('minus', 17)
  $('#btn-max').innerHTML = icon('square', 14)
  $('#btn-close').innerHTML = icon('x', 18)
  $('#btn-min').onclick = () => api.win.minimize()
  $('#btn-max').onclick = () => api.win.maximize()
  $('#btn-close').onclick = () => api.win.close()
  $('#btn-log').onclick = () => toggleDrawer()
  $('#game-pill').onclick = () => toggleDrawer(true)
  $('#player').onclick = () => openNickMenu($('#player'))
  api.on('win:state', s => {
    $('#btn-max').innerHTML = icon(s.maximized ? 'copy' : 'square', s.maximized ? 15 : 14)
    $('#btn-max').title = s.maximized ? 'Восстановить' : 'Развернуть'
  })

  $('#log-copy').innerHTML = `${icon('copy', 15)} Копировать`
  $('#log-folder').innerHTML = `${icon('folder-open', 15)} Папка логов`
  $('#log-close').innerHTML = icon('x', 16)
  $('#log-close').onclick = () => toggleDrawer(false)
  $('#log-copy').onclick = async () => {
    await navigator.clipboard.writeText(logLines.join('\n'))
    toast('Лог скопирован')
  }
  $('#log-folder').onclick = () => {
    const p = state.game.profile || state.settings.profile
    if (p && p.version) api.shell.openFolder('logs', p).catch(e => toast(e.message, 'err'))
  }

  onRoute(name => {
    document.querySelectorAll('.nav-item').forEach(b => b.setAttribute('aria-current', b.dataset.route === name ? 'page' : 'false'))
  })
}

let playerKey = ''
function renderPlayer () {
  const s = state.settings
  const g = state.game.state
  const status = g === 'running' ? 'В игре' : g === 'idle' ? 'Готов к игре' : 'Запускает игру'
  const key = [s.nickname, g === 'idle', status].join('|')
  if (key === playerKey) return // не перерисовываем на каждый процент загрузки
  playerKey = key
  $('#player').innerHTML = `
    <span class="avatar-wrap"><span class="avatar">${avatarSvg(s.nickname)}</span><span class="dot ${g !== 'idle' ? 'busy' : ''}"></span></span>
    <span><div class="player-name">${esc(s.nickname || 'Игрок')}</div><div class="player-status">${status}</div></span>`
}

let pillMode = ''
function renderGamePill () {
  const pill = $('#game-pill')
  const g = state.game
  if (g.state === 'idle') { pill.hidden = true; pillMode = ''; return }
  pill.hidden = false
  const label = profileLabel(g.profile || state.settings.profile)
  const mode = g.state === 'running' ? 'running' : 'loading'
  if (mode !== pillMode) {
    pillMode = mode
    pill.innerHTML = mode === 'running'
      ? '<span class="live"></span><span class="txt"></span>'
      : '<span class="bar"><i></i></span><span class="txt"></span>'
  }
  const txt = pill.querySelector('.txt')
  if (mode === 'running') {
    txt.textContent = `${label} · в игре`
  } else {
    const pct = g.state === 'starting' ? 100 : (typeof g.percent === 'number' ? g.percent : 0)
    pill.querySelector('.bar').style.setProperty('--p', pct + '%')
    txt.textContent = g.state === 'starting' ? 'Запускаю игру' : `${g.stage || 'Готовлю запуск'} · ${pct}%`
  }
}

// ---------- лог игры ----------
const logLines = []
function logClass (l) {
  if (l.startsWith('[Astra]')) return 'a'
  if (/ERROR|FATAL|Exception|Caused by/.test(l)) return 'e'
  if (/WARN/.test(l)) return 'w'
  return ''
}
function appendLog (lines) {
  const box = $('#log')
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  const frag = document.createDocumentFragment()
  for (const l of lines) {
    logLines.push(l)
    const span = document.createElement('span')
    const c = logClass(l)
    if (c) span.className = c
    span.textContent = l + '\n'
    frag.appendChild(span)
  }
  box.appendChild(frag)
  while (logLines.length > 3000) { logLines.shift(); box.firstChild && box.firstChild.remove() }
  if (atBottom) box.scrollTop = box.scrollHeight
}
function toggleDrawer (force) {
  const d = $('#drawer')
  const open = force ?? !d.classList.contains('open')
  d.classList.toggle('open', open)
  if (open) $('#log').scrollTop = $('#log').scrollHeight
}

// ---------- первый запуск ----------
function welcome () {
  return new Promise(resolve => {
    const m = modal(`
      <div class="welcome">
        <div class="logo-big">${starSvg(76)}</div>
        <h2>Добро пожаловать в Astra</h2>
        <p>Придумай ник — под ним ты будешь играть. Его можно сменить в настройках.</p>
        <div class="field">
          <label class="label" for="w-nick">Ник</label>
          <input class="input" id="w-nick" maxlength="16" placeholder="Например, Dobe" autocomplete="off" spellcheck="false" autofocus>
          <div class="hint" id="w-hint">От 3 до 16 символов: латиница, цифры и _</div>
        </div>
        <button class="btn primary" id="w-go" disabled>Продолжить</button>
      </div>`, { dismissible: false })
    const input = $('#w-nick', m.el); const btn = $('#w-go', m.el)
    const ok = () => /^[A-Za-z0-9_]{3,16}$/.test(input.value)
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^A-Za-z0-9_]/g, '')
      btn.disabled = !ok()
    })
    const submit = async () => {
      if (!ok()) return
      try {
        const settings = await api.settings.set({ nickname: input.value })
        set({ settings })
        m.close(); resolve()
      } catch (e) { $('#w-hint', m.el).textContent = e.message }
    }
    btn.onclick = submit
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
  })
}

// ---------- запуск ----------
async function init () {
  const [info, settings, gameStatus] = await Promise.all([api.info(), api.settings.get(), api.game.status()])
  set({ info, settings, game: gameStatus || { state: 'idle' } })
  renderShell()
  renderPlayer()
  renderGamePill()

  on((s, patch) => {
    if ('settings' in patch || 'game' in patch) renderPlayer()
    if ('game' in patch) renderGamePill()
  })

  api.on('game:status', st => {
    // Новый запуск — чистим лог прошлой сессии.
    if (state.game.state === 'idle' && st.state === 'preparing') {
      logLines.length = 0
      $('#log').textContent = ''
    }
    const wasBusy = state.game.state !== 'idle'
    set({ game: st })
    if (wasBusy && st.state === 'idle') refreshStats()
    if (st.error) {
      if (st.crashed) showCrash(st)
      else toast(st.error, 'err', 7000)
    }
  })
  api.on('game:log', lines => appendLog(lines))
  api.on('worlds:autobackup', ({ names }) => {
    toast(names.length === 1 ? `Сохранил копию мира «${names[0]}»` : `Сохранил копии миров: ${names.length}`, 'info')
    window.dispatchEvent(new CustomEvent('astra:worlds-changed'))
  })
  initUpdates()
  refreshStats()
  refreshPacks()
  api.on('task:status', st => {
    set({ tasks: { ...state.tasks, [st.key]: st } })
  })
  api.game.log().then(lines => lines.length && appendLog(lines)).catch(() => {})

  go('home')
  refreshVersions()
  if (!settings.nickname) await welcome()
}

init().catch(e => {
  document.body.innerHTML = `<pre style="padding:24px;color:#ff8a80">Не удалось запустить интерфейс: ${esc(e.message)}</pre>`
})
