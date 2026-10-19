import { icon } from './icons.js'

// Экранирование всего, что пришло извне (названия модов, описания, ники).
export function esc (v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function $ (sel, root = document) { return root.querySelector(sel) }
export function $$ (sel, root = document) { return [...root.querySelectorAll(sel)] }

export function html (strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (i < vals.length ? vals[i] : ''), '')
}

export function frag (markup) {
  const t = document.createElement('template')
  t.innerHTML = markup.trim()
  return t.content.firstElementChild
}

// ---------- форматирование ----------
export function plural (n, one, few, many) {
  const m10 = n % 10; const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function fmtNum (n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' млн'
  if (n >= 1e3) return Math.round(n / 1e3) + ' тыс.'
  return String(n)
}

export function fmtDate (iso) {
  const d = new Date(iso)
  if (Number.isNaN(+d)) return ''
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtSize (b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ'
  if (b >= 1024) return Math.round(b / 1024) + ' КБ'
  return b + ' Б'
}

// Иконка проекта Modrinth или плитка с буквой его цвета.
export function projectIcon (p, cls = '') {
  const letter = esc((p.title || '?').trim().charAt(0).toUpperCase())
  const color = typeof p.color === 'number' ? '#' + (p.color & 0xffffff).toString(16).padStart(6, '0') : '#5a1f22'
  if (p.icon && /^https:\/\/cdn\.modrinth\.com\//.test(p.icon)) {
    return `<div class="picon ${cls}" style="background:${color}33"><img src="${esc(p.icon)}" alt="" loading="lazy" data-fallback="${letter}"></div>`
  }
  return `<div class="picon ${cls}" style="background:linear-gradient(135deg, ${color}, #1a0a0b)">${letter}</div>`
}

// Если иконка не загрузилась — показываем букву (без inline-обработчиков, их запрещает CSP).
document.addEventListener('error', e => {
  const img = e.target
  // Скин Ely.by не загрузился — остаётся нарисованный аватар под ним.
  if (img.tagName === 'IMG' && img.dataset.skin !== undefined) { img.remove(); return }
  if (img.tagName === 'IMG' && img.dataset.fallback !== undefined) {
    const box = img.parentElement
    box.textContent = img.dataset.fallback
  }
}, true)

// ---------- тосты ----------
export function toast (text, kind = 'ok', ms = 3800) {
  const box = document.getElementById('toasts')
  const el = frag(`<div class="toast ${kind}">${icon(kind === 'err' ? 'triangle-alert' : kind === 'info' ? 'info' : 'check', 18)}<span>${esc(text)}</span></div>`)
  box.appendChild(el)
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250) }, ms)
}

// ---------- модальные окна ----------
export function modal (markup, { dismissible = true, onClose } = {}) {
  const prevFocus = document.activeElement
  const overlay = frag(`<div class="overlay" role="dialog" aria-modal="true"><div class="modal">${markup}</div></div>`)
  document.body.appendChild(overlay)
  const box = overlay.firstElementChild
  // Заголовок окна — подпись диалога для экранного диктора.
  const h = box.querySelector('h2')
  if (h) {
    h.id = h.id || 'dlg-' + Math.random().toString(36).slice(2)
    overlay.setAttribute('aria-labelledby', h.id)
  }
  const close = () => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
    if (prevFocus && prevFocus.focus) prevFocus.focus()
    if (onClose) onClose()
  }
  const onKey = e => {
    if (e.key === 'Escape' && dismissible) close()
    if (e.key === 'Tab') {
      const f = $$('button, input, select, textarea, [tabindex]:not([tabindex="-1"])', box).filter(x => !x.disabled)
      if (!f.length) return
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
    }
  }
  document.addEventListener('keydown', onKey)
  if (dismissible) overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  $$('[data-close]', box).forEach(b => b.addEventListener('click', close))
  setTimeout(() => { const first = $('[autofocus]', box) || $('button, input', box); if (first) first.focus() }, 30)
  return { el: box, close }
}

export function confirmDialog ({ title, text, ok = 'Удалить', cancel = 'Отмена' }) {
  return new Promise(resolve => {
    let answered = false
    const m = modal(`
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      <div class="modal-actions">
        <button class="btn ghost" data-close>${esc(cancel)}</button>
        <button class="btn primary" data-ok>${esc(ok)}</button>
      </div>`, { onClose: () => { if (!answered) resolve(false) } })
    $('[data-ok]', m.el).addEventListener('click', () => { answered = true; m.close(); resolve(true) })
  })
}

// ---------- выпадающее меню у кнопки ----------
export function popupMenu (anchor, markup, { onReady, align = 'left' } = {}) {
  document.querySelectorAll('.menu').forEach(m => m.remove())
  const menu = frag(`<div class="menu" role="menu">${markup}</div>`)
  document.body.appendChild(menu)
  const r = anchor.getBoundingClientRect()
  const mh = menu.offsetHeight
  const below = window.innerHeight - r.bottom
  menu.style.minWidth = Math.max(300, r.width) + 'px'
  menu.style.top = (below > mh + 12 ? r.bottom + 6 : Math.max(8, r.top - mh - 6)) + 'px'
  const left = align === 'right' ? r.right - menu.offsetWidth : r.left
  menu.style.left = Math.min(window.innerWidth - menu.offsetWidth - 8, Math.max(8, left)) + 'px'
  const close = () => {
    menu.remove()
    document.removeEventListener('mousedown', outside, true)
    document.removeEventListener('keydown', key)
    anchor.setAttribute('aria-expanded', 'false')
  }
  const outside = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close() }
  const key = e => {
    if (e.key === 'Escape') { close(); anchor.focus() }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = $$('.menu-item', menu)
      const i = items.indexOf(document.activeElement)
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items[next] && items[next].focus()
    }
  }
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', key)
  })
  anchor.setAttribute('aria-expanded', 'true')
  if (onReady) onReady(menu, close)
  const first = $('.menu-item[aria-checked="true"]', menu) || $('.menu-item', menu)
  if (first) first.focus()
  return close
}
