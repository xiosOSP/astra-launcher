import { icon } from '../ui/icons.js'
import { esc, $, $$, fmtNum, plural, projectIcon, toast } from '../ui/dom.js'
import { blockSvg } from '../art/blocks.js'
import { mountScene } from '../art/scene.js'
import { mountLaunch, QUICK } from '../ui/launch.js'
import { state, on, api, profile, versionInfo, selectProfile, refreshVersions, playTime, packInfo, activeName } from '../store.js'
import { go } from '../router.js'
import { openProject, loadInstalledIds, isInstalled } from './content.js'

const SODIUM = 'AANobbMI'

const SLIDES = [
  { scene: 'nether', l1: 'Приключения', l2: 'ждут', text: 'Исследуй бесконечные миры, строй свои мечты и выживай в самых сложных условиях.' },
  { scene: 'night', l1: 'Строй', l2: 'без границ', text: 'У каждой версии своя папка: миры, моды и ресурспаки разных сборок не смешиваются.' },
  { scene: 'cave', l1: 'Моды', l2: 'в один клик', text: 'Тысячи модов из Modrinth. Лаунчер сам поставит Fabric, зависимости и нужную Java.' }
]

const CARDS = [
  { key: 'latest', block: 'grass', seed: 21, sub: 'Последняя версия' },
  { key: QUICK[0], block: 'crimson', seed: 8, sub: 'Больше всего модов' },
  { key: QUICK[1], block: 'stone', seed: 14, sub: 'Проверенная классика' },
  { key: QUICK[2], block: 'planks', seed: 3, sub: 'Легендарные сборки' }
]

export function render (root) {
  const cleanups = []
  root.innerHTML = `
    <section class="hero frame cut" aria-label="Запуск игры">
      <div class="frame-inner">
        <div class="scene scene-fade on" data-layer="0"><canvas></canvas></div>
        <div class="scene scene-fade" data-layer="1"><canvas></canvas></div>
        <div class="hero-shade"></div>
        <div class="hero-content">
          <div class="hero-eyebrow" id="h-hello"></div>
          <div class="hero-slide" id="h-slide"></div>
          <div id="h-launch"></div>
        </div>
        <div class="dots" role="tablist" aria-label="Слайды">${SLIDES.map((_, i) => `<button aria-label="Слайд ${i + 1}" data-dot="${i}"></button>`).join('')}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">Выбор версии</h2>
        <button class="section-link" data-go="versions">Все версии ${icon('chevron-right', 16)}</button>
      </div>
      <div class="vgrid" id="h-versions"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title" id="h-mods-title">Популярные моды</h2>
        <button class="section-link" data-go="mods">Смотреть все ${icon('chevron-right', 16)}</button>
      </div>
      <div class="mgrid" id="h-mods"></div>
    </section>

    <section class="promo frame cut" aria-label="Ускорить игру">
      <div class="frame-inner">
        <div class="scene"><canvas></canvas></div>
        <div class="promo-shade"></div>
        <div class="promo-content" id="h-promo"></div>
      </div>
    </section>`

  // ---------- баннер со сценами ----------
  let slide = 0
  let front = 0
  const layers = $$('[data-layer]', root)
  let scenes = [mountScene($('canvas', layers[0]), SLIDES[0].scene), null]
  const slideBox = $('#h-slide', root)

  function paintSlide () {
    const s = SLIDES[slide]
    slideBox.innerHTML = `<h1 class="hero-title">${esc(s.l1)}<span class="l2">${esc(s.l2)}</span></h1><p class="hero-text">${esc(s.text)}</p>`
    $$('[data-dot]', root).forEach(d => d.setAttribute('aria-current', String(Number(d.dataset.dot) === slide)))
  }

  function showSlide (i) {
    if (i === slide) return
    slide = i
    const back = 1 - front
    if (scenes[back]) scenes[back].destroy()
    scenes[back] = mountScene($('canvas', layers[back]), SLIDES[i].scene)
    layers[back].classList.add('on')
    layers[front].classList.remove('on')
    const old = front
    front = back
    setTimeout(() => { if (front !== old && scenes[old]) { scenes[old].destroy(); scenes[old] = null } }, 1000)
    slideBox.classList.add('leaving')
    setTimeout(() => {
      paintSlide()
      slideBox.classList.remove('leaving')
      slideBox.classList.add('entering')
      requestAnimationFrame(() => requestAnimationFrame(() => slideBox.classList.remove('entering')))
    }, 260)
  }

  paintSlide()
  let auto = setInterval(() => showSlide((slide + 1) % SLIDES.length), 9000)
  $('.dots', root).addEventListener('click', e => {
    const d = e.target.closest('[data-dot]')
    if (!d) return
    clearInterval(auto)
    showSlide(Number(d.dataset.dot))
    auto = setInterval(() => showSlide((slide + 1) % SLIDES.length), 12000)
  })
  cleanups.push(() => { clearInterval(auto); scenes.forEach(s => s && s.destroy()) })

  const promoScene = mountScene($('.promo canvas', root), 'cave')
  cleanups.push(() => promoScene.destroy())

  cleanups.push(mountLaunch($('#h-launch', root)))

  function paintHello () {
    const total = playTime(state.stats.totalMs)
    $('#h-hello', root).innerHTML = `${icon('sparkles', 15)}<span>Привет, ${esc(activeName() || 'игрок')}</span>${total ? `<span class="hello-stat">${icon('clock', 14)}наиграно ${total}</span>` : ''}`
  }

  // ---------- карточки версий ----------
  function paintVersions () {
    const p = profile()
    const latest = state.versions?.latest?.release
    if (!state.versions && state.versionsError) {
      $('#h-versions', root).innerHTML = `<div class="notice err" style="grid-column:1/-1">${icon('triangle-alert', 18)}<div>Не удалось загрузить список версий: ${esc(state.versionsError)} Уже скачанные версии можно запускать и так — список сохранится, как только появится связь.<br><button class="btn sm" data-retry-versions style="margin-top:10px">${icon('refresh-cw', 14)}Повторить</button></div></div>`
      return
    }
    $('#h-versions', root).innerHTML = CARDS.map(c => {
      const id = c.key === 'latest' ? latest : c.key
      if (!id) return '<div class="skeleton" style="height:104px"></div>'
      const v = versionInfo(id)
      const selected = p.version === id && !p.pack
      const chips = [
        c.key === 'latest' ? '<span class="chip accent">Рекомендуем</span>' : '',
        selected && p.loader === 'fabric' ? '<span class="chip fabric">Fabric</span>' : '',
        v && v.installed ? '<span class="chip ok">Скачана</span>' : ''
      ].join('')
      return `<button class="vcard" aria-pressed="${selected}" data-version="${esc(id)}">
        <span class="check">${icon('check', 15)}</span>
        ${blockSvg(c.block, c.seed)}
        <span><div class="vname">${esc(id)}</div><div class="vsub">${c.sub}</div>${chips ? `<div class="chips">${chips}</div>` : ''}</span>
      </button>`
    }).join('')
  }

  $('#h-versions', root).addEventListener('click', async e => {
    const b = e.target.closest('[data-version]')
    if (!b || state.game.state !== 'idle') return
    const id = b.dataset.version
    const v = versionInfo(id)
    const keepFabric = !profile().pack && profile().loader === 'fabric' && v && v.fabric
    await selectProfile({ version: id, loader: keepFabric ? 'fabric' : 'vanilla' })
  })

  // ---------- популярные моды ----------
  let modsSeq = 0
  let modsHits = []
  async function loadMods () {
    const p = profile()
    const v = versionInfo(p.version)
    const gameVersion = v && v.fabric ? p.version : (state.versions?.latest?.release || '')
    $('#h-mods-title', root).textContent = gameVersion ? `Популярные моды для ${gameVersion}` : 'Популярные моды'
    const box = $('#h-mods', root)
    box.innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton" style="height:150px"></div>').join('')
    const seq = ++modsSeq
    try {
      const res = await api.content.search({ type: 'mod', gameVersion, sort: 'downloads', limit: 8 })
      if (seq !== modsSeq) return
      // Fabric API — библиотека, ставится сама; на витрине она не нужна.
      modsHits = res.hits.filter(h => h.id !== 'P7dR8mSH').slice(0, 4)
      await loadInstalledIds('mod')
      paintMods()
    } catch (e) {
      if (seq !== modsSeq) return
      box.innerHTML = `<div class="notice err" style="grid-column:1/-1">${icon('triangle-alert', 18)}<div>Каталог модов недоступен: ${esc(e.message)}</div></div>`
    }
  }
  function paintMods () {
    $('#h-mods', root).innerHTML = modsHits.map(h => `
      <button class="mcard" data-mod="${esc(h.id)}">
        <div class="mcard-top">${projectIcon(h)}<div><div class="name">${esc(h.title)}</div><div class="desc">${esc(h.description)}</div></div></div>
        <div class="foot">
          <span>${icon('download', 14)}${fmtNum(h.downloads)}</span>
          <span>${icon('heart', 14)}${fmtNum(h.follows)}</span>
          ${isInstalled('mod', h.id) ? '<span class="chip ok">Установлен</span>' : ''}
        </div>
      </button>`).join('')
  }
  $('#h-mods', root).addEventListener('click', e => {
    const b = e.target.closest('[data-mod]')
    if (!b) return
    const hit = modsHits.find(h => h.id === b.dataset.mod)
    if (hit) openProject(hit, 'mod')
  })
  const onInstalled = () => { paintMods(); paintPromo() }
  window.addEventListener('astra:installed', onInstalled)
  cleanups.push(() => window.removeEventListener('astra:installed', onInstalled))

  // ---------- «Ускорить игру» ----------
  function paintPromo () {
    const p = profile()
    const v = versionInfo(p.version)
    const box = $('#h-promo', root)
    const task = state.tasks.boost
    const busy = task && !task.done
    if (p.pack) {
      const pk = packInfo(p.pack)
      box.innerHTML = `<div><div class="promo-tag">${icon('package-plus', 15)}Выбрана сборка</div>
        <h2 class="promo-title">${esc(pk ? pk.name : 'Сборка модов')}</h2>
        <p class="promo-text">${pk ? `${pk.mods} ${plural(pk.mods, 'мод', 'мода', 'модов')} для Minecraft ${esc(pk.mcVersion)}. ` : ''}Свои моды в сборку можно добавить в разделе «Моды».</p></div>
        <button class="btn" data-go="modpacks">${icon('package-plus', 16)}Все сборки</button>`
      return
    }
    if (p.loader === 'fabric' && isInstalled('mod', SODIUM)) {
      box.innerHTML = `<div><div class="promo-tag">${icon('zap', 15)}Оптимизация включена</div>
        <h2 class="promo-title">Sodium уже работает в ${esc(p.version)}</h2>
        <p class="promo-text">Картинка плавнее, а нагрузка на видеокарту ниже. Можно добавить ещё модов из каталога.</p></div>
        <button class="btn" data-go="mods">${icon('puzzle', 16)}Открыть моды</button>`
      return
    }
    const can = v && v.fabric
    box.innerHTML = `<div><div class="promo-tag">${icon('zap', 15)}Больше FPS без настроек</div>
      <h2 class="promo-title">Ускорить ${esc(p.version || 'игру')}</h2>
      <p class="promo-text">${can ? 'Поставим Fabric и Sodium в отдельную сборку — обычная версия и её миры останутся как есть.' : 'Для этой версии Fabric пока нет. Выбери версию из списка выше, и кнопка заработает.'}</p></div>
      <button class="btn primary" data-boost ${can && !busy && state.game.state === 'idle' ? '' : 'disabled'}>
        ${busy ? icon('loader-circle', 16).replace('<svg ', '<svg class="spin" ') + 'Ставлю…' : icon('rocket', 16) + 'Ускорить игру'}
      </button>`
  }

  root.addEventListener('click', async e => {
    const g = e.target.closest('[data-go]')
    if (g) return go(g.dataset.go, g.dataset.go === 'mods' ? { sub: 'mod' } : {})
    if (e.target.closest('[data-retry-versions]')) return refreshVersions()
    if (e.target.closest('[data-boost]')) {
      try {
        const res = await api.boost(profile())
        await set2(res.profile)
        toast(`Готово: ${res.installed.join(', ')}. Можно играть!`)
        res.warnings.forEach(w => toast(w, 'err', 7000))
      } catch (err) { toast(err.message, 'err', 6000) }
    }
  })
  async function set2 (p) {
    await selectProfile(p)
    await loadInstalledIds('mod', p)
    window.dispatchEvent(new CustomEvent('astra:installed'))
  }

  // ---------- подписки ----------
  paintHello(); paintVersions(); paintPromo()
  let lastKey = ''
  const refresh = () => {
    const key = JSON.stringify(profile()) + (state.versions ? '1' : '0')
    if (key === lastKey) return
    lastKey = key
    if (state.versions) loadMods()
    loadInstalledIds('mod').then(paintPromo)
  }
  refresh()
  cleanups.push(on((_s, patch) => {
    if ('stats' in patch || 'accounts' in patch) paintHello()
    if ('settings' in patch) { paintHello(); paintVersions(); paintPromo(); refresh() }
    if ('versions' in patch || 'versionsError' in patch) { paintVersions(); paintPromo(); refresh() }
    if ('tasks' in patch || 'game' in patch || 'packs' in patch) paintPromo()
  }))

  return () => cleanups.forEach(fn => fn())
}
