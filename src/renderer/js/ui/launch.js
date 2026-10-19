// Кнопка «Играть» + выбор версии. Живёт в баннере главной.
import { icon } from './icons.js'
import { esc, popupMenu, confirmDialog, toast, $ } from './dom.js'
import { state, on, api, profile, profileLabel, versionInfo, selectProfile, sameProfile, packInfo } from '../store.js'
import { go } from '../router.js'

export const QUICK = ['1.20.1', '1.16.5', '1.12.2']

const PLAY_SVG = '<svg class="tri" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>'

export function mountLaunch (root) {
  root.innerHTML = `
    <div class="launch">
      <button class="btn primary play" id="play"></button>
      <button class="version-btn" id="vbtn" aria-haspopup="menu" aria-expanded="false"></button>
    </div>
    <div class="launch-stage" id="stage" aria-live="polite"></div>`
  const play = $('#play', root)
  const vbtn = $('#vbtn', root)
  const stage = $('#stage', root)

  const SPIN = icon('loader-circle', 20).replace('<svg ', '<svg class="spin" ')
  let mode = ''
  let vkey = ''

  // Разметка кнопки меняется только при смене режима. Во время загрузки обновляются
  // лишь ширина заливки и цифры — так полоса движется плавно, а значок не дёргается.
  function setMode (next) {
    if (mode === next) return
    mode = next
    play.removeAttribute('aria-label')
    play.className = 'btn primary play' + (next === 'idle' ? '' : ' ' + next)
    play.title = next === 'loading' ? 'Нажми, чтобы отменить запуск' : next === 'starting' ? 'Нажми, чтобы отменить запуск' : ''
    if (next === 'loading') {
      play.innerHTML = `<span class="play-fill"></span><span class="play-label">${SPIN}<span class="pct">0%</span></span>`
      play.style.setProperty('--p', '0%')
    } else if (next === 'starting') {
      play.innerHTML = `<span class="play-fill"></span><span class="play-label">${SPIN}<span>Запуск</span></span>`
      play.style.setProperty('--p', '100%')
    } else if (next === 'running') {
      play.innerHTML = `<span class="play-label">${icon('circle-stop', 20)}<span>Закрыть игру</span></span>`
    } else {
      play.innerHTML = `<span class="play-label">${PLAY_SVG}<span>Играть</span></span>`
    }
    stage.innerHTML = '<span class="st"></span><span class="dt"></span>'
  }

  function setStage (st, dt = '', err = false) {
    stage.classList.toggle('err', err)
    const a = stage.firstElementChild
    const b = stage.lastElementChild
    if (a.textContent !== st) a.textContent = st
    if (b.textContent !== dt) b.textContent = dt
  }

  function paint () {
    const g = state.game
    const p = profile()
    const v = versionInfo(p.version)

    if (g.state === 'preparing') {
      setMode('loading')
      const pct = typeof g.percent === 'number' ? g.percent : 0
      play.style.setProperty('--p', pct + '%')
      play.querySelector('.pct').textContent = pct + '%'
      play.setAttribute('aria-label', `Подготовка: ${pct}%. Нажми, чтобы отменить`)
      setStage(g.stage || 'Готовлю запуск', g.detail || '')
    } else if (g.state === 'starting') {
      setMode('starting')
      setStage('Запускаю игру', 'Окно игры откроется через несколько секунд')
    } else if (g.state === 'running') {
      setMode('running')
      setStage(`Игра запущена: ${profileLabel(g.profile || p)}`)
    } else {
      setMode('idle')
      play.disabled = !p.version
      if (g.error) {
        setStage(g.error, '', true)
      } else if (g.info) {
        setStage(g.info)
      } else {
        const installed = v && (p.loader === 'fabric' ? v.fabricInstalled : v.vanillaInstalled)
        setStage(!p.version
          ? (state.versionsError ? `Список версий не загрузился: ${state.versionsError}` : 'Загружаю список версий…')
          : installed ? 'Всё скачано, можно играть'
            : 'Перед первым запуском лаунчер скачает файлы игры')
      }
    }
    if (g.state !== 'idle') play.disabled = false

    const pk = p.pack ? packInfo(p.pack) : null
    const title = pk ? pk.name : (p.version || '…')
    const sub = pk ? `Сборка · ${p.version}` : p.loader === 'fabric' ? 'С модами (Fabric)' : (v && v.id === state.versions?.latest?.release ? 'Последняя версия' : 'Без модов')
    const key = [title, p.loader, sub].join('|')
    if (key !== vkey) {
      vkey = key
      vbtn.innerHTML = `
        ${icon(pk ? 'package-plus' : p.loader === 'fabric' ? 'puzzle' : 'package', 20)}
        <span class="vtext"><div class="v">${esc(title)}</div><div class="s">${esc(sub)}</div></span>
        ${icon('chevron-down', 18)}`
    }
    vbtn.disabled = g.state !== 'idle'
  }

  play.addEventListener('click', async () => {
    const g = state.game
    if (g.state === 'running') {
      const ok = await confirmDialog({ title: 'Закрыть игру?', text: 'Несохранённый прогресс в мире может пропасть. Лучше выйти из игры через меню.', ok: 'Закрыть игру', cancel: 'Не закрывать' })
      if (ok && state.game.state === 'running') api.game.stop()
      return
    }
    if (g.state === 'preparing' || g.state === 'starting') {
      const ok = await confirmDialog({ title: 'Отменить запуск?', text: 'Уже скачанные файлы останутся, в следующий раз загрузка продолжится.', ok: 'Отменить запуск', cancel: 'Продолжить' })
      // Пока окно было открыто, игра могла уже запуститься — тогда не закрываем её.
      if (ok && (state.game.state === 'preparing' || state.game.state === 'starting')) api.game.stop()
      return
    }
    if (g.state !== 'idle') return
    if (!state.settings.nickname) { toast('Сначала укажи ник в настройках', 'err'); return }
    try {
      await api.game.launch(profile())
    } catch { /* ошибку уже показал обработчик статуса */ }
  })

  vbtn.addEventListener('click', () => openVersionMenu(vbtn))

  paint()
  const off = on((_s, patch) => {
    if ('game' in patch || 'settings' in patch || 'versions' in patch || 'versionsError' in patch || 'packs' in patch) paint()
  })
  return off
}

function item (p, current) {
  const checked = sameProfile(p, current)
  if (p.pack) {
    const pk = packInfo(p.pack)
    if (!pk) return ''
    return `<button class="menu-item" role="menuitemradio" aria-checked="${checked}" data-v="${esc(p.version)}" data-l="fabric" data-pack="${esc(p.pack)}">
      ${icon(checked ? 'check' : 'package-plus', 16)}
      <span>${esc(pk.name)}</span>
      <span class="meta"><span class="chip fabric">${esc(p.version)}</span></span>
    </button>`
  }
  const v = versionInfo(p.version)
  const installed = v && (p.loader === 'fabric' ? v.fabricInstalled : v.vanillaInstalled)
  return `<button class="menu-item" role="menuitemradio" aria-checked="${checked}" data-v="${esc(p.version)}" data-l="${p.loader}">
    ${icon(checked ? 'check' : (p.loader === 'fabric' ? 'puzzle' : 'package'), 16)}
    <span>${esc(p.version)}</span>
    <span class="meta">${p.loader === 'fabric' ? '<span class="chip fabric">Fabric</span>' : ''}${installed ? '<span class="chip ok">Скачана</span>' : ''}</span>
  </button>`
}

function openVersionMenu (anchor) {
  const cur = profile()
  const latest = state.versions?.latest?.release
  const recent = (state.settings.recentProfiles || []).filter(r => !r.pack).slice(0, 4)
  const seen = new Set(recent.map(r => r.version + r.loader))
  const popular = [latest, ...QUICK].filter(Boolean).map(version => ({ version, loader: 'vanilla' }))
    .filter(p => !seen.has(p.version + p.loader))
  const packs = (state.packs || []).map(pk => ({ version: pk.mcVersion, loader: 'fabric', pack: pk.id }))
  const vi = versionInfo(cur.version)
  const fabricOk = vi && vi.fabric

  const markup = `
    ${packs.length ? `<div class="menu-group">Сборки</div>${packs.map(p => item(p, cur)).join('')}` : ''}
    ${recent.length ? `<div class="menu-group">Недавние</div>${recent.map(p => item(p, cur)).join('')}` : ''}
    ${popular.length ? `<div class="menu-group">Популярные</div>${popular.map(p => item(p, cur)).join('')}` : ''}
    <div class="menu-sep"></div>
    ${cur.pack ? '' : `<label class="menu-row" title="${fabricOk ? '' : 'Fabric пока не поддерживает эту версию'}">
      ${icon('puzzle', 16)} Моды (Fabric) для ${esc(cur.version || 'версии')}
      <span class="switch"><input type="checkbox" id="fab" ${cur.loader === 'fabric' ? 'checked' : ''} ${fabricOk ? '' : 'disabled'}><span></span></span>
    </label>`}
    <button class="menu-item" data-all>${icon('square-stack', 16)} Все версии</button>`

  popupMenu(anchor, markup, {
    onReady (menu, close) {
      menu.addEventListener('click', async e => {
        const b = e.target.closest('.menu-item')
        if (!b) return
        close()
        if (b.dataset.all !== undefined) return go('versions')
        await selectProfile(b.dataset.pack ? { version: b.dataset.v, loader: 'fabric', pack: b.dataset.pack } : { version: b.dataset.v, loader: b.dataset.l })
      })
      const fab = menu.querySelector('#fab')
      if (fab) fab.addEventListener('change', async () => {
        await selectProfile({ version: cur.version, loader: fab.checked ? 'fabric' : 'vanilla' })
        close()
      })
    }
  })
}
