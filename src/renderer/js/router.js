// Переключение разделов. Каждая страница: render(root, params) → необязательная функция очистки.
const pages = {}
let current = null
let cleanup = null
const listeners = new Set()

export function register (name, page) { pages[name] = page }

export function go (name, params = {}) {
  if (!pages[name]) return
  if (cleanup) { try { cleanup() } catch {} }
  cleanup = null
  current = name
  // Новый пустой контейнер на каждый переход: обработчики прошлой страницы
  // уходят вместе со старым элементом и не копятся.
  const old = document.getElementById('view-inner')
  const root = old.cloneNode(false)
  old.replaceWith(root)
  document.getElementById('view').scrollTop = 0
  cleanup = pages[name].render(root, params) || null
  for (const fn of listeners) fn(name)
}

export function onRoute (fn) { listeners.add(fn) }
export function currentRoute () { return current }
