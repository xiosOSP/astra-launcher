// Переключение разделов. Каждая страница: render(root, params) → необязательная функция очистки.
const pages = {}
let current = null
let cleanup = null
const listeners = new Set()

// Старые имена разделов ведут в объединённые разделы с нужной вкладкой.
const ALIASES = {
  versions: ['library', { sub: 'versions' }],
  modpacks: ['library', { sub: 'modpacks' }],
  packs: ['mods', { sub: 'resourcepack' }],
  shaders: ['mods', { sub: 'shader' }],
  shots: ['worlds', { sub: 'shots' }]
}

export function register (name, page) { pages[name] = page }

export function go (name, params = {}) {
  if (ALIASES[name]) {
    const [to, extra] = ALIASES[name]
    return go(to, { ...extra, ...params })
  }
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

// Раздел с вкладками сверху: «Версии | Сборки», «Моды | Ресурспаки | Шейдеры».
// Вкладка рисуется своей страницей в отдельном контейнере; заголовок страницы
// заменяют сами вкладки. Последняя открытая вкладка запоминается.
const lastSub = {}
export function tabbed (key, tabs) {
  return {
    render (root, params = {}) {
      let sub = tabs.some(t => t.id === params.sub) ? params.sub : (lastSub[key] || tabs[0].id)
      let subCleanup = null
      root.innerHTML = `<nav class="section-tabs" role="tablist">${tabs.map(t =>
        `<button role="tab" data-sub="${t.id}">${t.label}</button>`).join('')}</nav><div class="subpage"></div>`
      const show = (id, p = {}) => {
        if (subCleanup) { try { subCleanup() } catch {} }
        sub = lastSub[key] = id
        root.querySelectorAll('[data-sub]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sub === id)))
        const old = root.querySelector('.subpage')
        const box = old.cloneNode(false)
        old.replaceWith(box)
        const t = tabs.find(x => x.id === id)
        subCleanup = t.page.render(box, p) || null
      }
      root.querySelector('.section-tabs').addEventListener('click', e => {
        const b = e.target.closest('[data-sub]')
        if (b && b.dataset.sub !== sub) { show(b.dataset.sub); document.getElementById('view').scrollTop = 0 }
      })
      const { sub: _s, ...rest } = params
      show(sub, rest)
      return () => { if (subCleanup) try { subCleanup() } catch {} }
    }
  }
}

export function onRoute (fn) { listeners.add(fn) }
export function currentRoute () { return current }
