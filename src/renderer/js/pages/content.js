// Раздел «Моды» и «Ресурспаки»: каталог Modrinth и установленное.
import { icon } from '../ui/icons.js'
import { esc, $, $$, fmtNum, fmtSize, plural, projectIcon, toast, modal, confirmDialog } from '../ui/dom.js'
import { blockSvg } from '../art/blocks.js'
import { state, on, api, profile, profileLabel, versionInfo, selectProfile, isGameBusy } from '../store.js'

const TEXT = {
  mod: {
    title: 'Моды', one: 'мод', few: 'мода', many: 'модов',
    search: 'Найти мод: карта, оптимизация, шейдеры…',
    url: 'mod',
    emptyInstalled: 'Модов пока нет',
    emptyInstalledText: 'Открой каталог и поставь что-нибудь — например, Sodium для плавной картинки.'
  },
  resourcepack: {
    title: 'Ресурспаки', one: 'ресурспак', few: 'ресурспака', many: 'ресурспаков',
    search: 'Найти ресурспак: 32x, анимации, ванильный стиль…',
    url: 'resourcepack',
    emptyInstalled: 'Ресурспаков пока нет',
    emptyInstalledText: 'Поставь пак из каталога, а потом включи его в игре: Настройки → Пакеты ресурсов.'
  }
}

const SORTS = [['downloads', 'Популярные'], ['relevance', 'По запросу'], ['follows', 'Любимые'], ['newest', 'Новые'], ['updated', 'Обновлённые']]

// Запущена ли игра именно с этой сборкой (её файлы трогать нельзя).
function profileRunning () {
  const g = state.game
  const p = profile()
  return isGameBusy() && g.profile && g.profile.version === p.version && g.profile.loader === p.loader
}

// ---------- установка (общая для главной и каталога) ----------
const installedCache = new Map() // key profile+type -> Set(projectId)

function cacheKey (p, type) { return `${p.version}|${p.loader}|${type}` }

export async function loadInstalledIds (type, p = profile()) {
  if (!p.version || (type === 'mod' && p.loader !== 'fabric')) return new Set()
  try {
    const ids = new Set(await api.content.installedIds({ profile: p, type }))
    installedCache.set(cacheKey(p, type), ids)
    return ids
  } catch { return new Set() }
}

export function isInstalled (type, id, p = profile()) {
  const s = installedCache.get(cacheKey(p, type))
  return !!(s && s.has(id))
}

export function installButton (hit, type, { size = 'sm' } = {}) {
  const t = state.tasks[hit.id]
  if (t && !t.done) {
    const pct = t.total ? Math.round((t.current / t.total) * 100) : null
    return `<button class="btn ${size}" disabled data-install="${esc(hit.id)}">${icon('loader-circle', 15).replace('<svg ', '<svg class="spin" ')}${pct !== null ? pct + '%' : 'Ставлю'}</button>`
  }
  if (isInstalled(type, hit.id)) {
    return `<button class="btn ${size} done" disabled>${icon('check', 15)}Установлен</button>`
  }
  const p = profile()
  const needFabric = type === 'mod' && p.loader !== 'fabric'
  return `<button class="btn ${size} outline-accent" data-install="${esc(hit.id)}">${icon('download', 15)}${needFabric ? 'Установить с Fabric' : 'Установить'}</button>`
}

export async function installProject (hit, type) {
  let p = profile()
  if (!p.version) { toast('Сначала выбери версию', 'err'); return }
  if (type === 'mod' && p.loader !== 'fabric') {
    const v = versionInfo(p.version)
    if (!v || !v.fabric) { toast(`Fabric пока не вышел для ${p.version}. Выбери другую версию.`, 'err'); return }
    await selectProfile({ version: p.version, loader: 'fabric' })
    p = profile()
    toast(`Включил Fabric для ${p.version}`, 'info')
  }
  try {
    const res = await api.content.install({ projectId: hit.id, profile: p, type })
    await loadInstalledIds(type, p)
    toast(`Установлено: ${res.installed.join(', ')}`)
    res.warnings.forEach(w => toast(w, 'err', 6000))
  } catch (e) {
    toast(e.message, 'err', 6000)
  }
  // Обновить кнопки на экране.
  state.tasks = { ...state.tasks }
  window.dispatchEvent(new CustomEvent('astra:installed'))
}

export function openProject (hit, type) {
  const T = TEXT[type]
  const cats = (hit.categories || []).slice(0, 5).map(c => `<span class="chip">${esc(c)}</span>`).join('')
  const m = modal(`
    <div class="modal-head">
      ${projectIcon(hit, 'lg')}
      <div>
        <h2>${esc(hit.title)}</h2>
        <div class="stats">
          <span>${icon('user', 14)}${esc(hit.author || '')}</span>
          <span>${icon('download', 14)}${fmtNum(hit.downloads)}</span>
          <span>${icon('heart', 14)}${fmtNum(hit.follows)}</span>
        </div>
      </div>
    </div>
    <p>${esc(hit.description)}</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${cats}</div>
    <div class="modal-actions">
      <button class="btn ghost" data-site>${icon('external-link', 15)}Страница на Modrinth</button>
      <span data-slot></span>
    </div>`)
  const slot = $('[data-slot]', m.el)
  const paint = () => { slot.innerHTML = installButton(hit, type, { size: '' }) }
  paint()
  const off = on((_s, patch) => { if ('tasks' in patch) paint() })
  const onInst = () => paint()
  window.addEventListener('astra:installed', onInst)
  const obs = new MutationObserver(() => { if (!m.el.isConnected) { off(); window.removeEventListener('astra:installed', onInst); obs.disconnect() } })
  obs.observe(document.body, { childList: true })
  slot.addEventListener('click', e => { if (e.target.closest('[data-install]')) installProject(hit, type) })
  $('[data-site]', m.el).onclick = () => api.shell.openExternal(`https://modrinth.com/${T.url}/${encodeURIComponent(hit.slug || hit.id)}`)
}

// ---------- страница ----------
export function render (root, { type = 'mod', tab = 'catalog' } = {}) {
  const T = TEXT[type]
  const ui = { tab, query: '', sort: 'downloads', offset: 0, hits: [], total: 0, loading: false, error: null, installed: [], seq: 0 }
  let searchTimer = 0

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">${T.title}</h1>
        <p class="page-sub" id="c-sub"></p>
      </div>
      <div class="actions">
        <div class="seg" role="tablist" id="c-tabs">
          <button data-tab="catalog">Каталог</button>
          <button data-tab="installed">Установленные<span class="n" id="c-count"></span></button>
        </div>
        <button class="btn btn-icon" id="c-folder" title="Открыть папку">${icon('folder-open', 18)}</button>
      </div>
    </div>
    <div id="c-body"></div>`

  const body = $('#c-body', root)

  function gate () {
    const p = profile()
    if (!p.version) return `<div class="empty">${blockSvg('stone', 3)}<h3>Версия не выбрана</h3><p>Выбери версию на главной или в разделе «Версии».</p></div>`
    if (type !== 'mod' || p.loader === 'fabric') return null
    const v = versionInfo(p.version)
    if (v && !v.fabric) {
      return `<div class="empty">${blockSvg('crimson', 11)}<h3>Для ${esc(p.version)} модов нет</h3><p>Fabric пока не поддерживает эту версию. Выбери другую — например, последнюю.</p><button class="btn" data-goto-versions>${icon('square-stack', 16)}Выбрать версию</button></div>`
    }
    return `<div class="empty">${blockSvg('grass', 5)}<h3>Моды работают через Fabric</h3><p>Сейчас выбрана обычная ${esc(p.version)}. Включи Fabric — у сборки появится своя папка для модов, миры обычной версии не пострадают.</p><button class="btn primary" data-enable-fabric>${icon('puzzle', 16)}Включить Fabric для ${esc(p.version)}</button></div>`
  }

  function paintHead () {
    const p = profile()
    $('#c-sub', root).textContent = p.version ? `Для ${profileLabel(p)}` : ''
    $$('#c-tabs button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === ui.tab)))
    $('#c-count', root).textContent = ui.installed.length ? String(ui.installed.length) : ''
  }

  function hitRow (h) {
    const cats = (h.categories || []).slice(0, 3).map(c => `<span class="chip">${esc(c)}</span>`).join('')
    return `<div class="row" data-id="${esc(h.id)}">
      ${projectIcon(h)}
      <div class="row-main" data-open style="cursor:pointer">
        <div class="row-title">${esc(h.title)} <span class="author">${esc(h.author || '')}</span></div>
        <div class="row-sub">${esc(h.description)}</div>
        ${cats ? `<div class="cats">${cats}</div>` : ''}
      </div>
      <div class="row-meta"><span title="Скачиваний">${icon('download', 14)}${fmtNum(h.downloads)}</span><span title="В избранном">${icon('heart', 14)}${fmtNum(h.follows)}</span></div>
      <div class="row-actions" data-actions>${installButton(h, type)}</div>
    </div>`
  }

  function paintCatalog () {
    const g = gate()
    if (g) { body.innerHTML = g; return }
    let list
    if (ui.error) list = `<div class="notice err">${icon('triangle-alert', 18)}<div>${esc(ui.error)}<br><button class="btn sm" data-retry style="margin-top:10px">${icon('refresh-cw', 14)}Повторить</button></div></div>`
    else if (ui.loading && !ui.hits.length) list = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:84px"></div>').join('')
    else if (!ui.hits.length) list = `<div class="empty">${blockSvg('stone', 9)}<h3>Ничего не нашлось</h3><p>Попробуй другой запрос или английское название.</p></div>`
    else list = ui.hits.map(hitRow).join('')
    const more = ui.hits.length < ui.total && !ui.error
      ? `<div class="more"><button class="btn" data-more ${ui.loading ? 'disabled' : ''}>${ui.loading ? 'Загружаю…' : 'Показать ещё'}</button></div>` : ''
    const toolbarExists = $('#c-toolbar', body)
    if (!toolbarExists) {
      body.innerHTML = `
        <div class="toolbar" id="c-toolbar">
          <div class="input-icon grow">${icon('search', 17)}<input class="input" id="c-q" placeholder="${esc(T.search)}" spellcheck="false"></div>
          <select class="input" id="c-sort" aria-label="Сортировка">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="list" id="c-list"></div><div id="c-more"></div>`
      const q = $('#c-q', body); q.value = ui.query
      $('#c-sort', body).value = ui.sort
      q.addEventListener('input', () => {
        clearTimeout(searchTimer)
        searchTimer = setTimeout(() => {
          ui.query = q.value.trim()
          if (ui.query && ui.sort === 'downloads') { ui.sort = 'relevance'; $('#c-sort', body).value = 'relevance' }
          search(true)
        }, 350)
      })
      $('#c-sort', body).addEventListener('change', e => { ui.sort = e.target.value; search(true) })
    }
    $('#c-list', body).innerHTML = list
    $('#c-more', body).innerHTML = more
  }

  function installedRow (it) {
    const toggle = type === 'mod'
      ? `<label class="switch" title="${it.enabled ? 'Выключить' : 'Включить'}"><input type="checkbox" data-toggle="${esc(it.file)}" ${it.enabled ? 'checked' : ''}><span></span></label>` : ''
    return `<div class="row ${it.enabled ? '' : 'disabled-item'}">
      ${projectIcon(it)}
      <div class="row-main">
        <div class="row-title">${esc(it.title)} ${it.version ? `<span class="author">${esc(it.version)}</span>` : ''} ${it.enabled ? '' : '<span class="chip">Выключен</span>'}</div>
        <div class="row-sub">${esc(it.description || it.file)}</div>
      </div>
      <div class="row-meta"><span>${it.folder ? 'папка' : fmtSize(it.size)}</span></div>
      <div class="row-actions">${toggle}<button class="btn sm btn-icon danger" data-remove="${esc(it.file)}" title="Удалить">${icon('trash-2', 15)}</button></div>
    </div>`
  }

  function paintInstalled () {
    const g = gate()
    if (g) { body.innerHTML = g; return }
    if (!ui.installed.length) {
      body.innerHTML = `<div class="empty">${blockSvg(type === 'mod' ? 'planks' : 'grass', 4)}<h3>${T.emptyInstalled}</h3><p>${T.emptyInstalledText}</p><button class="btn" data-tab-go="catalog">${icon('search', 16)}Открыть каталог</button></div>`
      return
    }
    const off = ui.installed.filter(i => !i.enabled).length
    body.innerHTML = `
      <div class="toolbar"><span class="hint">${ui.installed.length} ${plural(ui.installed.length, T.one, T.few, T.many)}${off ? `, выключено: ${off}` : ''}${type === 'resourcepack' ? '. Включаются в игре: Настройки → Пакеты ресурсов' : ''}</span></div>
      <div class="list">${ui.installed.map(installedRow).join('')}</div>`
  }

  function paint () {
    paintHead()
    if (ui.tab === 'catalog') {
      if (gate()) $('#c-toolbar', body) && (body.innerHTML = '')
      paintCatalog()
    } else {
      body.innerHTML = ''
      paintInstalled()
    }
  }

  async function search (reset) {
    const p = profile()
    if (gate()) { paint(); return }
    const seq = ++ui.seq
    if (reset) { ui.offset = 0; ui.hits = [] }
    ui.loading = true; ui.error = null
    paintCatalog()
    try {
      const res = await api.content.search({ type, query: ui.query, gameVersion: p.version, loader: p.loader, sort: ui.sort, offset: ui.offset, limit: 20 })
      if (seq !== ui.seq) return
      ui.hits = reset ? res.hits : ui.hits.concat(res.hits)
      ui.total = res.total
      ui.offset = ui.hits.length
    } catch (e) {
      if (seq !== ui.seq) return
      ui.error = e.message
    }
    ui.loading = false
    if (ui.tab === 'catalog') paintCatalog()
  }

  async function loadInstalled () {
    const p = profile()
    if (!p.version || (type === 'mod' && p.loader !== 'fabric')) { ui.installed = []; return }
    try { ui.installed = await api.content.list({ profile: p, type }) } catch (e) { ui.installed = []; toast(e.message, 'err') }
    await loadInstalledIds(type, p)
  }

  // ---------- события ----------
  root.addEventListener('click', async e => {
    const t = e.target
    const tabBtn = t.closest('[data-tab]') || t.closest('[data-tab-go]')
    if (tabBtn) {
      ui.tab = tabBtn.dataset.tab || tabBtn.dataset.tabGo
      if (ui.tab === 'installed') await loadInstalled()
      paint()
      if (ui.tab === 'catalog' && !ui.hits.length && !ui.loading) search(true)
      return
    }
    if (t.closest('#c-folder')) {
      const p = profile()
      if (!p.version) return
      api.shell.openFolder(type === 'mod' ? 'mods' : 'resourcepacks', p).catch(err => toast(err.message, 'err'))
      return
    }
    if (t.closest('[data-enable-fabric]')) {
      await selectProfile({ version: profile().version, loader: 'fabric' })
      return
    }
    if (t.closest('[data-goto-versions]')) { (await import('../router.js')).go('versions'); return }
    if (t.closest('[data-retry]')) { search(true); return }
    if (t.closest('[data-more]')) { search(false); return }
    const inst = t.closest('[data-install]')
    if (inst) {
      const hit = ui.hits.find(h => h.id === inst.dataset.install)
      if (hit) installProject(hit, type)
      return
    }
    const rm = t.closest('[data-remove]')
    if (rm) {
      if (profileRunning()) { toast('Сначала закрой игру — эта сборка сейчас запущена', 'err'); return }
      const it = ui.installed.find(i => i.file === rm.dataset.remove)
      const ok = await confirmDialog({ title: `Удалить «${it ? it.title : rm.dataset.remove}»?`, text: 'Файл удалится из папки сборки. Поставить заново можно из каталога.' })
      if (!ok) return
      try {
        await api.content.remove({ profile: profile(), type, file: rm.dataset.remove })
        await loadInstalled(); paint()
        toast('Удалено')
      } catch (err) { toast(err.message, 'err') }
      return
    }
    const open = t.closest('[data-open]')
    if (open) {
      const hit = ui.hits.find(h => h.id === open.closest('[data-id]').dataset.id)
      if (hit) openProject(hit, type)
    }
  })

  root.addEventListener('change', async e => {
    const tg = e.target.closest('[data-toggle]')
    if (!tg) return
    if (profileRunning()) { toast('Сначала закрой игру — эта сборка сейчас запущена', 'err'); tg.checked = !tg.checked; return }
    try {
      await api.content.toggle({ profile: profile(), file: tg.dataset.toggle })
      await loadInstalled(); paint()
    } catch (err) { toast(err.message, 'err') }
  })

  const onInstalled = async () => {
    await loadInstalled()
    paintHead()
    if (ui.tab === 'catalog') $$('[data-actions]', body).forEach(box => {
      const hit = ui.hits.find(h => h.id === box.closest('[data-id]').dataset.id)
      if (hit) box.innerHTML = installButton(hit, type)
    })
    else paint()
  }
  window.addEventListener('astra:installed', onInstalled)

  let lastProfile = JSON.stringify(profile())
  const off = on((_s, patch) => {
    if ('tasks' in patch && ui.tab === 'catalog') {
      $$('[data-actions]', body).forEach(box => {
        const hit = ui.hits.find(h => h.id === box.closest('[data-id]').dataset.id)
        if (hit) box.innerHTML = installButton(hit, type)
      })
    }
    if ('settings' in patch || 'versions' in patch) {
      const now = JSON.stringify(profile())
      if (now !== lastProfile || 'versions' in patch) {
        const changed = now !== lastProfile
        lastProfile = now
        loadInstalled().then(() => {
          paint()
          if (ui.tab === 'catalog' && (changed || !ui.hits.length)) search(true)
        })
      }
    }
  })

  paint()
  loadInstalled().then(() => {
    paintHead()
    if (ui.tab === 'catalog') search(true); else paint()
  })

  return () => { off(); window.removeEventListener('astra:installed', onInstalled); clearTimeout(searchTimer) }
}
