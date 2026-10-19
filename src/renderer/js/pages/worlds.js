// Раздел «Миры»: миры выбранной сборки, их копии, восстановление.
import { icon } from '../ui/icons.js'
import { esc, $, fmtSize, plural, toast, confirmDialog } from '../ui/dom.js'
import { blockSvg } from '../art/blocks.js'
import { state, on, api, profile, profileLabel } from '../store.js'
import { go } from '../router.js'
import { friendDialog } from '../ui/tools.js'

export function fmtAgo (ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const min = Math.round(diff / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`
  return new Date(ms).toLocaleDateString('ru-RU')
}

function fmtWhen (ms) {
  return new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function render (root) {
  let worlds = []
  let loading = true
  const busy = new Set()

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Миры</h1>
        <p class="page-sub" id="w-sub"></p>
      </div>
      <div class="actions">
        <button class="btn btn-icon" id="w-refresh" title="Обновить">${icon('refresh-cw', 17)}</button>
        <button class="btn" id="w-folder">${icon('folder-open', 16)}Папка миров</button>
        <button class="btn primary" id="w-friend">${icon('users', 16)}Играть с другом</button>
      </div>
    </div>
    <div id="w-note"></div>
    <div id="w-body"></div>`
  const body = $('#w-body', root)

  function paintNote () {
    const s = state.settings
    $('#w-note', root).innerHTML = s.autoBackup
      ? `<p class="hint" style="margin:-8px 0 16px">${icon('shield-check', 14)} После каждой игры лаунчер сам сохраняет копию изменённых миров и хранит последние ${s.keepBackups}. <button class="section-link" data-go-settings style="display:inline-flex;margin:0">Настроить</button></p>`
      : `<div class="notice" style="margin-bottom:16px">${icon('info', 18)}<div>Автокопии миров выключены. <button class="section-link" data-go-settings style="display:inline-flex;margin:0">Включить в настройках</button></div></div>`
  }

  function worldCard (w) {
    const isBusy = busy.has(w.name)
    const backups = w.backups.length
      ? `<div class="backups">${w.backups.slice(0, 6).map(b => `
          <div class="backup-row">
            ${icon(b.auto ? 'history' : 'archive', 15)}
            <span class="when">${fmtWhen(b.time)}</span>
            <span class="chip">${b.kind === 'auto' ? 'авто' : b.kind === 'pre' ? 'до восстановления' : 'вручную'}</span>
            <span class="size">${fmtSize(b.size)}</span>
            <button class="btn sm ghost" data-restore="${esc(b.file)}" data-world="${esc(w.name)}" ${isBusy ? 'disabled' : ''}>${icon('archive-restore', 14)}Восстановить</button>
            <button class="btn sm btn-icon ghost danger" data-del-backup="${esc(b.file)}" data-world="${esc(w.name)}" title="Удалить копию">${icon('trash-2', 14)}</button>
          </div>`).join('')}
          ${w.backups.length > 6 ? `<button class="section-link" data-open-backups="${esc(w.name)}" style="margin:6px 0 0">Ещё ${w.backups.length - 6} в папке</button>` : ''}
        </div>`
      : '<div class="hint" style="margin-top:10px">Копий пока нет.</div>'
    return `<section class="world">
      <div class="world-top">
        <div class="world-icon">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : blockSvg('grass', w.name.length * 13)}</div>
        <div class="row-main">
          <div class="row-title">${esc(w.name)}</div>
          <div class="row-sub">${w.lastPlayed ? 'Играл ' + fmtAgo(w.lastPlayed) : ''} · ${fmtSize(w.size)}</div>
        </div>
        <div class="row-actions">
          <button class="btn sm btn-icon" data-open-world="${esc(w.name)}" title="Открыть папку мира">${icon('folder-open', 15)}</button>
          <button class="btn sm" data-friend="${esc(w.name)}" title="Открыть этот мир для друга">${icon('users', 15)}С другом</button>
          <button class="btn sm outline-accent" data-backup="${esc(w.name)}" ${isBusy ? 'disabled' : ''}>${isBusy ? icon('loader-circle', 15).replace('<svg ', '<svg class="spin" ') + 'Сохраняю…' : icon('archive', 15) + 'Сделать копию'}</button>
        </div>
      </div>
      ${backups}
    </section>`
  }

  function paint () {
    const p = profile()
    $('#w-sub', root).textContent = p.version ? `Сборка ${profileLabel(p)}. У каждой сборки свои миры.` : ''
    paintNote()
    if (!p.version) {
      body.innerHTML = `<div class="empty">${blockSvg('stone', 3)}<h3>Версия не выбрана</h3><p>Выбери версию на главной.</p></div>`
      return
    }
    if (loading && !worlds.length) {
      body.innerHTML = '<div class="list">' + Array.from({ length: 3 }, () => '<div class="skeleton" style="height:110px"></div>').join('') + '</div>'
      return
    }
    if (!worlds.length) {
      body.innerHTML = `<div class="empty">${blockSvg('grass', 9)}<h3>Миров пока нет</h3><p>Создай мир в игре — он появится здесь, и лаунчер начнёт делать его копии.</p><button class="btn" data-go-home>${icon('play', 16)}К запуску игры</button></div>`
      return
    }
    body.innerHTML = `<div class="worlds">${worlds.map(worldCard).join('')}</div>`
  }

  async function load () {
    const p = profile()
    if (!p.version) { loading = false; worlds = []; paint(); return }
    loading = true
    try { worlds = await api.worlds.list(p) } catch (e) { toast(e.message, 'err'); worlds = [] }
    loading = false
    paint()
  }

  root.addEventListener('click', async e => {
    const t = e.target
    const p = profile()
    if (t.closest('#w-refresh')) return load()
    if (t.closest('#w-folder')) return api.shell.openFolder('saves', p).catch(err => toast(err.message, 'err'))
    if (t.closest('#w-friend')) return p.version ? friendDialog(null, p) : toast('Сначала выбери версию', 'err')
    const fr = t.closest('[data-friend]')
    if (fr) return friendDialog(fr.dataset.friend, p)
    if (t.closest('[data-go-settings]')) return go('settings')
    if (t.closest('[data-go-home]')) return go('home')
    const ow = t.closest('[data-open-world]')
    if (ow) return api.worlds.openWorld(p, ow.dataset.openWorld).catch(err => toast(err.message, 'err'))
    const ob = t.closest('[data-open-backups]')
    if (ob) return api.worlds.openBackups(p, ob.dataset.openBackups).catch(err => toast(err.message, 'err'))
    const b = t.closest('[data-backup]')
    if (b) {
      const name = b.dataset.backup
      busy.add(name); paint()
      try {
        await api.worlds.backup(p, name)
        toast(`Копия мира «${name}» сохранена`)
      } catch (err) { toast(err.message, 'err') }
      busy.delete(name)
      return load()
    }
    const r = t.closest('[data-restore]')
    if (r) {
      const world = r.dataset.world
      const ok = await confirmDialog({
        title: `Восстановить «${world}»?`,
        text: 'Мир вернётся к состоянию на момент копии. Текущее состояние лаунчер сначала сохранит отдельной копией — его тоже можно будет вернуть.',
        ok: 'Восстановить'
      })
      if (!ok) return
      busy.add(world); paint()
      try {
        await api.worlds.restore(p, world, r.dataset.restore)
        toast(`Мир «${world}» восстановлен`)
      } catch (err) { toast(err.message, 'err', 6000) }
      busy.delete(world)
      return load()
    }
    const d = t.closest('[data-del-backup]')
    if (d) {
      const ok = await confirmDialog({ title: 'Удалить копию?', text: 'Архив удалится с диска. Сам мир не пострадает.' })
      if (!ok) return
      try { await api.worlds.removeBackup(p, d.dataset.world, d.dataset.delBackup) } catch (err) { toast(err.message, 'err') }
      return load()
    }
  })

  const onAuto = () => load()
  window.addEventListener('astra:worlds-changed', onAuto)
  let last = JSON.stringify(profile())
  const off = on((_s, patch) => {
    if ('settings' in patch) {
      const now = JSON.stringify(profile())
      if (now !== last) { last = now; worlds = []; load() } else paintNote()
    }
  })
  paint()
  load()
  return () => { off(); window.removeEventListener('astra:worlds-changed', onAuto) }
}

