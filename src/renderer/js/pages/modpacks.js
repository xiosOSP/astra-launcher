// Раздел «Сборки»: готовые наборы модов из Modrinth. Каждая сборка — своя папка и свои миры.
import { icon } from '../ui/icons.js'
import { esc, $, fmtNum, plural, projectIcon, toast, confirmDialog } from '../ui/dom.js'
import { blockSvg } from '../art/blocks.js'
import { state, on, api, profile, selectProfile, refreshPacks, playTime, sameProfile } from '../store.js'
import { go } from '../router.js'
import { shareDialog, importPack } from '../ui/tools.js'

const SORTS = [['downloads', 'Популярные'], ['relevance', 'По запросу'], ['follows', 'Любимые'], ['newest', 'Новые'], ['updated', 'Обновлённые']]

export function render (root, { tab } = {}) {
  const ui = { tab: tab || (state.packs.length ? 'installed' : 'catalog'), query: '', sort: 'downloads', hits: [], total: 0, offset: 0, loading: false, error: null, seq: 0, updates: {} }
  let timer = 0

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Сборки</h1>
        <p class="page-sub">Готовые наборы модов. Лаунчер сам поставит нужную версию игры, Fabric и все моды — у каждой сборки свои миры.</p>
      </div>
      <div class="actions">
        <button class="btn" id="p-import" title="Открыть сборку из файла .mrpack (например, от друга). Файл можно и просто перетащить в окно">${icon('file-input', 16)}Открыть файл</button>
        <div class="seg" id="p-tabs">
          <button data-tab="catalog">Каталог</button>
          <button data-tab="installed">Установленные<span class="n" id="p-count"></span></button>
        </div>
      </div>
    </div>
    <div id="p-body"></div>`
  const body = $('#p-body', root)

  function head () {
    root.querySelectorAll('#p-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === ui.tab)))
    $('#p-count', root).textContent = state.packs.length ? String(state.packs.length) : ''
  }

  function taskBtn (id, label, cls = 'outline-accent') {
    const t = state.tasks['pack:' + id]
    if (t && !t.done) {
      const pct = typeof t.percent === 'number' ? t.percent : null
      return `<button class="btn sm" disabled title="${esc(t.stage || '')}">${icon('loader-circle', 15).replace('<svg ', '<svg class="spin" ')}${pct !== null ? pct + '%' : 'Ставлю'}</button>`
    }
    return `<button class="btn sm ${cls}" data-install="${esc(id)}">${icon('download', 15)}${label}</button>`
  }

  function hitRow (h) {
    const installed = state.packs.some(p => p.id === h.id)
    const cats = (h.categories || []).slice(0, 3).map(c => `<span class="chip">${esc(c)}</span>`).join('')
    const mc = h.versions && h.versions.length ? h.versions[h.versions.length - 1] : ''
    return `<div class="row" data-id="${esc(h.id)}">
      ${projectIcon(h)}
      <div class="row-main">
        <div class="row-title">${esc(h.title)} <span class="author">${esc(h.author || '')}</span></div>
        <div class="row-sub">${esc(h.description)}</div>
        <div class="cats">${mc ? `<span class="chip fabric">Minecraft ${esc(mc)}</span>` : ''}${cats}</div>
      </div>
      <div class="row-meta"><span title="Скачиваний">${icon('download', 14)}${fmtNum(h.downloads)}</span></div>
      <div class="row-actions" data-actions>${installed ? `<button class="btn sm done" disabled>${icon('check', 15)}Установлена</button>` : taskBtn(h.id, 'Установить')}</div>
    </div>`
  }

  function paintCatalog () {
    if (!$('#p-toolbar', body)) {
      body.innerHTML = `
        <div class="toolbar" id="p-toolbar">
          <div class="input-icon grow">${icon('search', 17)}<input class="input" id="p-q" placeholder="Найти сборку: оптимизация, приключения, Cobblemon…" spellcheck="false"></div>
          <select class="input" id="p-sort" aria-label="Сортировка">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="list" id="p-list"></div><div id="p-more"></div>`
      $('#p-q', body).value = ui.query
      $('#p-sort', body).value = ui.sort
      $('#p-q', body).addEventListener('input', e => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          ui.query = e.target.value.trim()
          if (ui.query && ui.sort === 'downloads') { ui.sort = 'relevance'; $('#p-sort', body).value = 'relevance' }
          search(true)
        }, 350)
      })
      $('#p-sort', body).addEventListener('change', e => { ui.sort = e.target.value; search(true) })
    }
    let list
    if (ui.error) list = `<div class="notice err">${icon('triangle-alert', 18)}<div>${esc(ui.error)}<br><button class="btn sm" data-retry style="margin-top:10px">${icon('refresh-cw', 14)}Повторить</button></div></div>`
    else if (ui.loading && !ui.hits.length) list = Array.from({ length: 5 }, () => '<div class="skeleton" style="height:96px"></div>').join('')
    else if (!ui.hits.length) list = `<div class="empty">${blockSvg('stone', 9)}<h3>Ничего не нашлось</h3><p>Попробуй другой запрос или английское название.</p></div>`
    else list = ui.hits.map(hitRow).join('')
    $('#p-list', body).innerHTML = list
    $('#p-more', body).innerHTML = ui.hits.length < ui.total && !ui.error ? `<div class="more"><button class="btn" data-more ${ui.loading ? 'disabled' : ''}>Показать ещё</button></div>` : ''
  }

  function packCard (pk) {
    const cur = profile()
    const selected = cur.pack === pk.id
    const st = state.stats.byProfile && state.stats.byProfile['pack:' + pk.id]
    const played = st ? playTime(st.playMs) : ''
    const upd = ui.updates[pk.id]
    const running = state.game.state !== 'idle' && state.game.profile && state.game.profile.pack === pk.id
    return `<section class="pack ${selected ? 'selected' : ''}">
      ${projectIcon({ title: pk.name, icon: pk.icon }, 'lg')}
      <div class="row-main">
 <div class="row-title">${esc(pk.name)} ${selected ? '<span class="chip accent">Выбрана</span>' : ''} ${pk.local ? '<span class="chip">из файла</span>' : ''}</div>
        <div class="row-sub">Minecraft ${esc(pk.mcVersion)}${pk.loaderVersion ? ` · Fabric ${esc(pk.loaderVersion)}` : ''} · ${pk.mods} ${plural(pk.mods, 'мод', 'мода', 'модов')} · версия ${esc(pk.versionNumber)}${played ? ` · наиграно ${played}` : ''}</div>
        ${upd && upd.available ? `<div class="cats"><span class="chip ok">Есть обновление ${esc(upd.versionNumber)}</span></div>` : ''}
      </div>
      <div class="row-actions">
        <button class="btn sm btn-icon" data-share="${esc(pk.id)}" title="Поделиться сборкой">${icon('share-2', 15)}</button>
        <button class="btn sm btn-icon" data-folder="${esc(pk.id)}" title="Папка сборки">${icon('folder-open', 15)}</button>
        <button class="btn sm btn-icon danger" data-remove="${esc(pk.id)}" title="Удалить сборку" ${running ? 'disabled' : ''}>${icon('trash-2', 15)}</button>
        ${upd && upd.available ? taskBtn(pk.id, 'Обновить', '') : ''}
        <button class="btn sm primary" data-play="${esc(pk.id)}" ${running ? 'disabled' : ''}>${icon('play', 15)}${selected ? 'Играть' : 'Выбрать'}</button>
      </div>
    </section>`
  }

  function paintInstalled () {
    if (!state.packs.length) {
      body.innerHTML = `<div class="empty">${blockSvg('planks', 6)}<h3>Сборок пока нет</h3><p>В каталоге есть готовые наборы: для FPS, приключений, выживания. Установка — одна кнопка.</p><button class="btn primary" data-tab-go="catalog">${icon('search', 16)}Открыть каталог</button></div>`
      return
    }
    body.innerHTML = `<div class="toolbar"><span class="hint grow">Моды в сборку можно добавлять в разделе «Моды», когда она выбрана.</span><button class="btn sm" data-check>${icon('refresh-cw', 15)}Проверить обновления</button></div>
      <div class="packs">${state.packs.map(packCard).join('')}</div>`
  }

  function paint () {
    head()
    if (ui.tab === 'catalog') paintCatalog()
    else { body.innerHTML = ''; paintInstalled() }
  }

  async function search (reset) {
    const seq = ++ui.seq
    if (reset) { ui.offset = 0; ui.hits = [] }
    ui.loading = true; ui.error = null
    paintCatalog()
    try {
      const res = await api.packs.search({ query: ui.query, sort: ui.sort, offset: ui.offset, limit: 20 })
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

  async function installPack (id) {
    try {
      const res = await api.packs.install(id)
      await refreshPacks()
      await selectProfile(res.profile)
      toast(res.updated ? `Сборка «${res.name}» обновлена` : `Сборка «${res.name}» установлена и выбрана. Нажми «Играть»!`)
      delete ui.updates[id]
    } catch (e) { toast(e.message, 'err', 7000) }
    paint()
  }

  root.addEventListener('click', async e => {
    const t = e.target
    const tb = t.closest('[data-tab]') || t.closest('[data-tab-go]')
    if (tb) {
      ui.tab = tb.dataset.tab || tb.dataset.tabGo
      paint()
      if (ui.tab === 'catalog' && !ui.hits.length) search(true)
      return
    }
    if (t.closest('[data-retry]')) return search(true)
    if (t.closest('[data-more]')) return search(false)
    const ins = t.closest('[data-install]')
    if (ins) return installPack(ins.dataset.install)
    const pl = t.closest('[data-play]')
    if (pl) {
      const pk = state.packs.find(p => p.id === pl.dataset.play)
      if (!pk) return
      const p = { version: pk.mcVersion, loader: 'fabric', pack: pk.id }
      if (!sameProfile(profile(), p)) await selectProfile(p)
      go('home')
      return
    }
    if (t.closest('#p-import')) { await importPack(); paint(); return }
    const sh = t.closest('[data-share]')
    if (sh) {
      const pk = state.packs.find(p => p.id === sh.dataset.share)
      if (pk) shareDialog({ version: pk.mcVersion, loader: 'fabric', pack: pk.id }, pk.name)
      return
    }
    const fo = t.closest('[data-folder]')
    if (fo) {
      const pk = state.packs.find(p => p.id === fo.dataset.folder)
      if (pk) api.shell.openFolder('instance', { version: pk.mcVersion, loader: 'fabric', pack: pk.id }).catch(err => toast(err.message, 'err'))
      return
    }
    const rm = t.closest('[data-remove]')
    if (rm) {
      const pk = state.packs.find(p => p.id === rm.dataset.remove)
      if (!pk) return
      const ok = await confirmDialog({
        title: `Удалить сборку «${pk.name}»?`,
        text: 'Удалится вся папка сборки: моды, настройки и миры этой сборки. Если миры нужны — сначала сделай их копию в разделе «Миры» и перенеси архив в другое место.',
        ok: 'Удалить сборку'
      })
      if (!ok) return
      try {
        const settings = await api.packs.remove(pk.id)
        const { set } = await import('../store.js')
        set({ settings })
        await refreshPacks()
        toast('Сборка удалена')
      } catch (err) { toast(err.message, 'err') }
      paint()
      return
    }
    if (t.closest('[data-check]')) {
      const btn = t.closest('[data-check]')
      btn.disabled = true
      let found = 0
      for (const pk of state.packs) {
        if (pk.local) continue
        try {
          const r = await api.packs.checkUpdate(pk.id)
          ui.updates[pk.id] = r
          if (r.available) found++
        } catch {}
      }
      toast(found ? `Обновления есть у ${found} ${found === 1 ? 'сборки' : 'сборок'}` : 'Все сборки последней версии')
      paint()
    }
  })

  const off = on((_s, patch) => {
    if ('tasks' in patch) {
      if (ui.tab === 'catalog') {
        root.querySelectorAll('[data-actions]').forEach(box => {
          const hit = ui.hits.find(h => h.id === box.closest('[data-id]').dataset.id)
          if (hit) box.outerHTML = `<div class="row-actions" data-actions>${state.packs.some(p => p.id === hit.id) ? `<button class="btn sm done" disabled>${icon('check', 15)}Установлена</button>` : taskBtn(hit.id, 'Установить')}</div>`
        })
      } else paintInstalled()
    }
    if ('packs' in patch || 'settings' in patch || 'game' in patch || 'stats' in patch) {
      head()
      if (ui.tab === 'installed') paintInstalled()
    }
  })

  paint()
  refreshPacks().then(() => { head(); if (ui.tab === 'catalog') search(true); else paintInstalled() })
  return () => { off(); clearTimeout(timer) }
}
