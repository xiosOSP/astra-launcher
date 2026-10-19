import { icon } from '../ui/icons.js'
import { esc, $, frag, fmtDate, toast, confirmDialog } from '../ui/dom.js'
import { blockSvg } from '../art/blocks.js'
import { api, profile } from '../store.js'

export function render (root) {
  let shots = []
  let lightboxOpen = false

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Скриншоты</h1>
        <p class="page-sub">Снимки из всех сборок. В игре нажми F2, чтобы сделать новый.</p>
      </div>
      <div class="actions">
        <button class="btn btn-icon" id="s-refresh" title="Обновить">${icon('refresh-cw', 17)}</button>
        <button class="btn" id="s-folder">${icon('folder-open', 16)}Папка</button>
      </div>
    </div>
    <div id="s-body"></div>`
  const body = $('#s-body', root)

  function label (inst) { return inst.endsWith('-fabric') ? inst.replace(/-fabric$/, ' + Fabric') : inst }

  function paint () {
    if (!shots.length) {
      body.innerHTML = `<div class="empty">${blockSvg('grass', 12)}<h3>Скриншотов пока нет</h3><p>Зайди в игру и нажми F2 — снимок сразу появится здесь.</p></div>`
      return
    }
    body.innerHTML = `<div class="shots">${shots.map((s, i) => `
      <button class="shot" data-i="${i}" title="${esc(s.file)}">
        <img src="${esc(s.url)}" alt="Скриншот ${esc(fmtDate(s.mtime))}" loading="lazy">
        <span class="cap"><span>${esc(label(s.instance))}</span><span>${fmtDate(s.mtime)}</span></span>
      </button>`).join('')}</div>`
  }

  async function load () {
    try { shots = await api.shots.list() } catch (e) { toast(e.message, 'err'); shots = [] }
    paint()
  }

  // Просмотрщик работает со своей копией списка: если в фоне появится новый скриншот,
  // номера не сдвинутся и «Удалить» удалит именно то, что на экране.
  function lightbox (i, opener) {
    const list = shots.slice()
    const box = frag(`<div class="lightbox" role="dialog" aria-modal="true" aria-label="Просмотр скриншота">
      <div class="lightbox-img"><img alt=""></div>
      <div class="lightbox-bar">
        <span class="info"></span>
        <button class="btn sm" data-show>${icon('folder-open', 15)}Показать в папке</button>
        <button class="btn sm danger" data-del>${icon('trash-2', 15)}Удалить</button>
      </div>
      <button class="btn btn-icon nav-btn prev" data-prev title="Предыдущий">${icon('chevron-left', 20)}</button>
      <button class="btn btn-icon nav-btn next" data-next title="Следующий">${icon('chevron-right', 20)}</button>
      <button class="btn btn-icon close-btn" data-x title="Закрыть">${icon('x', 18)}</button>
    </div>`)
    document.body.appendChild(box)
    lightboxOpen = true
    const show = () => {
      const s = list[i]
      $('img', box).src = s.url
      $('img', box).alt = `Скриншот ${label(s.instance)}, ${fmtDate(s.mtime)}`
      $('.info', box).textContent = `${label(s.instance)} — ${fmtDate(s.mtime)} — ${i + 1} из ${list.length}`
      const single = list.length < 2
      $('[data-prev]', box).hidden = single
      $('[data-next]', box).hidden = single
    }
    const close = () => {
      box.remove()
      document.removeEventListener('keydown', key)
      lightboxOpen = false
      load()
      if (opener && opener.isConnected) opener.focus()
    }
    const step = d => { i = (i + d + list.length) % list.length; show() }
    const key = e => {
      if (document.querySelector('.overlay')) return // открыт диалог подтверждения — Esc относится к нему
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'Tab') {
        // фокус не уходит из просмотрщика
        const f = [...box.querySelectorAll('button')].filter(b => !b.hidden)
        if (!f.length) return
        const k = f.indexOf(document.activeElement)
        if (e.shiftKey && k <= 0) { e.preventDefault(); f[f.length - 1].focus() } else if (!e.shiftKey && k === f.length - 1) { e.preventDefault(); f[0].focus() }
      }
    }
    document.addEventListener('keydown', key)
    box.addEventListener('click', async e => {
      if (e.target.closest('[data-x]') || e.target.classList.contains('lightbox-img')) return close()
      if (e.target.closest('[data-prev]')) step(-1)
      if (e.target.closest('[data-next]')) step(1)
      if (e.target.closest('[data-show]')) api.shell.showFile(list[i].instance, list[i].file).catch(err => toast(err.message, 'err'))
      if (e.target.closest('[data-del]')) {
        const s = list[i]
        box.style.visibility = 'hidden'
        const ok = await confirmDialog({ title: 'Удалить скриншот?', text: `Файл ${s.file} удалится с диска.` })
        box.style.visibility = ''
        if (!ok) return $('[data-del]', box).focus()
        try {
          await api.shots.remove({ instance: s.instance, file: s.file })
        } catch (err) {
          toast(err.message, 'err')
          return
        }
        list.splice(i, 1)
        shots = shots.filter(x => !(x.instance === s.instance && x.file === s.file))
        paint()
        toast('Скриншот удалён')
        if (!list.length) return close()
        i = Math.min(i, list.length - 1)
        show()
      }
    })
    show()
    $('[data-x]', box).focus()
  }

  body.addEventListener('click', e => {
    const b = e.target.closest('[data-i]')
    if (b) lightbox(Number(b.dataset.i), b)
  })
  $('#s-refresh', root).onclick = load
  $('#s-folder', root).onclick = () => {
    const p = profile()
    const r = p.version ? api.shell.openFolder('screenshots', p) : api.shell.openFolder('instances')
    r.catch(e => toast(e.message, 'err'))
  }

  body.innerHTML = '<div class="shots">' + Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:16/9"></div>').join('') + '</div>'
  load()
  const onFocus = () => { if (!lightboxOpen) load() }
  window.addEventListener('focus', onFocus)
  return () => window.removeEventListener('focus', onFocus)
}
