import { icon } from '../ui/icons.js'
import { esc, $, $$, fmtDate, toast, confirmDialog } from '../ui/dom.js'
import { blockSvg } from '../art/blocks.js'
import { state, on, api, profile, selectProfile, refreshVersions, statsFor, playTime } from '../store.js'
import { go } from '../router.js'

const FILTERS = [
  ['release', 'Релизы'],
  ['snapshot', 'Снапшоты'],
  ['old', 'Старые'],
  ['installed', 'Скачанные']
]
const BLOCK = { release: 'grass', snapshot: 'crimson', old_beta: 'planks', old_alpha: 'stone' }
const TYPE_LABEL = { release: 'Релиз', snapshot: 'Снапшот', old_beta: 'Бета', old_alpha: 'Альфа' }
const PAGE = 60

export function render (root) {
  const ui = { filter: 'release', query: '', shown: PAGE }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Версии</h1>
        <p class="page-sub">Все версии из официального списка. Выбери, с какой играть, и включи Fabric, если нужны моды.</p>
      </div>
      <div class="actions"><button class="btn btn-icon" id="v-refresh" title="Обновить список">${icon('refresh-cw', 17)}</button></div>
    </div>
    <div class="toolbar">
      <div class="seg" id="v-filters">${FILTERS.map(([k, l]) => `<button data-f="${k}">${l}<span class="n" data-n="${k}"></span></button>`).join('')}</div>
      <div class="input-icon grow">${icon('search', 17)}<input class="input" id="v-q" placeholder="Найти версию, например 1.20" spellcheck="false"></div>
    </div>
    <div id="v-body"></div>`

  const body = $('#v-body', root)

  function filtered () {
    const all = state.versions ? state.versions.versions : []
    const q = ui.query.toLowerCase()
    return all.filter(v => {
      if (q && !v.id.toLowerCase().includes(q)) return false
      if (ui.filter === 'installed') return v.installed
      if (ui.filter === 'old') return v.type === 'old_beta' || v.type === 'old_alpha'
      return v.type === ui.filter
    })
  }

  function counts () {
    const all = state.versions ? state.versions.versions : []
    const n = {
      release: all.filter(v => v.type === 'release').length,
      snapshot: all.filter(v => v.type === 'snapshot').length,
      old: all.filter(v => v.type.startsWith('old')).length,
      installed: all.filter(v => v.installed).length
    }
    $$('[data-n]', root).forEach(s => { s.textContent = n[s.dataset.n] || '' })
    $$('[data-f]', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === ui.filter)))
  }

  function row (v) {
    const p = profile()
    const selV = p.version === v.id && p.loader === 'vanilla'
    const selF = p.version === v.id && p.loader === 'fabric'
    const chips = [
      v.id === state.versions.latest.release ? '<span class="chip accent">Последняя</span>' : '',
      v.vanillaInstalled ? '<span class="chip ok">Скачана</span>' : '',
      v.fabricInstalled ? '<span class="chip fabric">Fabric скачан</span>' : ''
    ].join('')
    return `<div class="row ${selV || selF ? 'selected' : ''}">
      ${blockSvg(BLOCK[v.type] || 'stone', v.id.length * 7 + v.id.charCodeAt(v.id.length - 1))}
      <div class="row-main">
        <div class="row-title">${esc(v.id)} ${chips}</div>
        <div class="row-sub">${TYPE_LABEL[v.type] || v.type}, ${fmtDate(v.releaseTime)}${v.fabric ? '' : ', без Fabric'}${(() => { const st = statsFor(v.id); const t = playTime(st.playMs); return t ? ` · наиграно ${t}` : '' })()}</div>
      </div>
      <div class="row-actions">
        ${v.installed ? `<button class="btn sm btn-icon danger" data-del="${esc(v.id)}" title="Удалить файлы версии">${icon('trash-2', 15)}</button>` : ''}
        ${v.fabric ? `<button class="btn sm ${selF ? 'done' : ''}" data-pick="${esc(v.id)}" data-l="fabric" ${selF ? 'disabled' : ''}>${icon(selF ? 'check' : 'puzzle', 15)}С модами</button>` : ''}
        <button class="btn sm ${selV ? 'done' : 'outline-accent'}" data-pick="${esc(v.id)}" data-l="vanilla" ${selV ? 'disabled' : ''}>${icon(selV ? 'check' : 'play', 15)}${selV ? 'Выбрана' : 'Выбрать'}</button>
      </div>
    </div>`
  }

  function paint () {
    counts()
    if (state.versionsError && !state.versions) {
      body.innerHTML = `<div class="notice err">${icon('triangle-alert', 18)}<div>Не удалось загрузить список версий: ${esc(state.versionsError)}<br><button class="btn sm" data-retry style="margin-top:10px">${icon('refresh-cw', 14)}Повторить</button></div></div>`
      return
    }
    if (!state.versions) {
      body.innerHTML = `<div class="list">${Array.from({ length: 8 }, () => '<div class="skeleton" style="height:64px"></div>').join('')}</div>`
      return
    }
    const list = filtered()
    if (!list.length) {
      body.innerHTML = ui.filter === 'installed' && !ui.query
        ? `<div class="empty">${blockSvg('grass', 2)}<h3>Скачанных версий нет</h3><p>Выбери версию и нажми «Играть» на главной — лаунчер скачает всё сам.</p></div>`
        : `<div class="empty">${blockSvg('stone', 6)}<h3>Такой версии нет</h3><p>Проверь номер или посмотри в другой вкладке.</p></div>`
      return
    }
    const slice = list.slice(0, ui.shown)
    body.innerHTML = `<div class="list">${slice.map(row).join('')}</div>
      ${list.length > ui.shown ? `<div class="more"><button class="btn" data-more>Показать ещё ${Math.min(PAGE, list.length - ui.shown)}</button></div>` : ''}`
  }

  $('#v-filters', root).addEventListener('click', e => {
    const b = e.target.closest('[data-f]')
    if (!b) return
    ui.filter = b.dataset.f; ui.shown = PAGE
    paint()
  })
  let t = 0
  $('#v-q', root).addEventListener('input', e => {
    clearTimeout(t)
    t = setTimeout(() => { ui.query = e.target.value.trim(); ui.shown = PAGE; paint() }, 150)
  })
  $('#v-refresh', root).addEventListener('click', async () => {
    const b = $('#v-refresh', root)
    b.firstElementChild.classList.add('spin')
    await refreshVersions()
    b.firstElementChild && b.firstElementChild.classList.remove('spin')
  })

  body.addEventListener('click', async e => {
    if (e.target.closest('[data-more]')) { ui.shown += PAGE; paint(); return }
    if (e.target.closest('[data-retry]')) { refreshVersions(); return }
    const pick = e.target.closest('[data-pick]')
    if (pick) {
      if (state.game.state !== 'idle') { toast('Сначала закрой игру', 'err'); return }
      await selectProfile({ version: pick.dataset.pick, loader: pick.dataset.l })
      toast(`Выбрана ${pick.dataset.pick}${pick.dataset.l === 'fabric' ? ' с Fabric' : ''}`)
      go('home')
      return
    }
    const del = e.target.closest('[data-del]')
    if (del) {
      const id = del.dataset.del
      const ok = await confirmDialog({
        title: `Удалить ${id}?`,
        text: 'Удалятся только файлы игры этой версии. Миры, моды и скриншоты останутся — при следующем запуске версия скачается снова.'
      })
      if (!ok) return
      try {
        await api.versions.remove(id)
        toast(`Версия ${id} удалена`)
        await refreshVersions()
      } catch (err) { toast(err.message, 'err') }
    }
  })

  paint()
  return on((_s, patch) => { if ('versions' in patch || 'settings' in patch || 'versionsError' in patch || 'stats' in patch) paint() })
}
