// Горячие клавиши AstraLauncher. Работают только в активном окне приложения.
import { icon } from './icons.js'
import { esc, modal, toast } from './dom.js'
import { state } from '../store.js'
import { go, currentRoute } from '../router.js'

export const SHORTCUT_ACTIONS = Object.freeze([
  { id: 'home', label: 'Главная', hint: 'Открыть главный экран', defaultKey: 'Ctrl+Digit1', route: 'home' },
  { id: 'library', label: 'Библиотека', hint: 'Версии и сборки', defaultKey: 'Ctrl+Digit2', route: 'library' },
  { id: 'mods', label: 'Моды', hint: 'Каталог модов, шейдеров и ресурспаков', defaultKey: 'Ctrl+Digit3', route: 'mods' },
  { id: 'worlds', label: 'Миры', hint: 'Миры и скриншоты', defaultKey: 'Ctrl+Digit4', route: 'worlds' },
  { id: 'servers', label: 'Серверы', hint: 'Список серверов', defaultKey: 'Ctrl+Digit5', route: 'servers' },
  { id: 'settings', label: 'Настройки', hint: 'Открыть настройки лаунчера', defaultKey: 'Ctrl+Digit6', route: 'settings' },
  { id: 'play', label: 'Запустить игру', hint: 'Запустить выбранную версию с обычными проверками', defaultKey: 'Ctrl+Enter' },
  { id: 'log', label: 'Журнал игры', hint: 'Показать или скрыть журнал', defaultKey: 'Ctrl+Shift+KeyL' },
  { id: 'help', label: 'Подсказка', hint: 'Список всех горячих клавиш', defaultKey: 'F1' }
])

export const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(SHORTCUT_ACTIONS.map(a => [a.id, a.defaultKey])))

const RESERVED = new Set([
  'Ctrl+KeyR', 'Ctrl+Shift+KeyR', 'Ctrl+KeyW', 'Ctrl+Shift+KeyW',
  'Ctrl+Shift+KeyI', 'Ctrl+Shift+KeyJ', 'Alt+F4', 'Alt+Space'
])

export function validShortcut (value) {
  if (typeof value !== 'string' || value.length > 40 || !value) return false
  const parts = value.split('+')
  const key = parts.pop()
  const mods = parts
  if (!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Enter|Space)$/.test(key)) return false
  if (mods.some(m => !['Ctrl', 'Alt', 'Shift'].includes(m))) return false
  if (new Set(mods).size !== mods.length) return false
  if (mods.join('+') !== ['Ctrl', 'Alt', 'Shift'].filter(m => mods.includes(m)).join('+')) return false
  if (!mods.includes('Ctrl') && !mods.includes('Alt') && !/^F([1-9]|1[0-2])$/.test(key)) return false
  if (RESERVED.has(value)) return false
  return true
}

export function shortcutFromEvent (e) {
  if (e.metaKey || e.isComposing || (e.getModifierState && e.getModifierState('AltGraph'))) return ''
  const code = e.code
  if (!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Enter|Space)$/.test(code)) return ''
  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(code)
  return parts.join('+')
}

export function formatShortcut (value) {
  if (!value) return 'Не назначено'
  return value.split('+').map(part => {
    if (part.startsWith('Digit')) return part.slice(5)
    if (part.startsWith('Key')) return part.slice(3)
    if (part === 'Space') return 'Пробел'
    return part
  }).join(' + ')
}

function bindings () {
  return (state.settings && state.settings.shortcuts) || DEFAULT_SHORTCUTS
}

let recording = false

export function showShortcutHelp () {
  if (document.querySelector('.overlay')) return
  const rows = SHORTCUT_ACTIONS.map(a => {
    const key = formatShortcut(bindings()[a.id])
    return '<div class="shortcut-row"><span><b>' + esc(a.label) + '</b><small>' +
      esc(a.hint) + '</small></span><kbd class="shortcut-keys">' + esc(key) + '</kbd></div>'
  }).join('')
  modal('<h2>' + icon('keyboard', 21) + ' Горячие клавиши</h2>' +
    '<p>Быстрые команды работают, когда активно окно AstraLauncher, но не во время ввода текста или игры.</p>' +
    '<div class="shortcut-list">' + rows + '</div>' +
    '<div class="modal-actions"><button class="btn primary" data-close>Понятно</button></div>')
}

function runShortcut (id, toggleLog) {
  const action = SHORTCUT_ACTIONS.find(a => a.id === id)
  if (!action) return
  if (action.route) {
    go(action.route)
  } else if (id === 'help') {
    showShortcutHelp()
  } else if (id === 'log') {
    toggleLog()
  } else if (id === 'play') {
    if (state.game.state !== 'idle') {
      toast('Игра уже запущена или готовится к запуску', 'info')
      return
    }
    if (!state.settings.nickname || !state.settings.profile.version) {
      toast('Сначала выбери ник и версию игры', 'info')
      go('home')
      return
    }
    // Та же кнопка, что на главной: проверки, предупреждения и отмена сохраняются.
    if (currentRoute() !== 'home') go('home')
    const button = document.getElementById('play')
    if (button && !button.disabled) button.click()
  }
}

export function initShortcuts ({ toggleLog }) {
  const onKey = e => {
    if (recording || e.defaultPrevented || e.repeat || e.metaKey || e.isComposing) return
    if (!document.hasFocus() || document.querySelector('.overlay, .menu')) return
    const target = e.target
    if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return
    const combo = shortcutFromEvent(e)
    if (!combo || !validShortcut(combo)) return
    const match = SHORTCUT_ACTIONS.find(a => bindings()[a.id] === combo)
    if (!match) return
    e.preventDefault()
    e.stopPropagation()
    runShortcut(match.id, toggleLog)
  }
  document.addEventListener('keydown', onKey, true)
  return () => document.removeEventListener('keydown', onKey, true)
}

export function mountShortcutSettings (root, save) {
  const box = root.querySelector('#st-shortcuts')
  if (!box) return () => {}
  let capture = ''
  let busy = false

  function paint () {
    box.innerHTML = SHORTCUT_ACTIONS.map(a => {
      const key = bindings()[a.id] || ''
      const active = capture === a.id
      return '<div class="shortcut-row">' +
        '<span class="shortcut-info"><b>' + esc(a.label) + '</b><small>' + esc(a.hint) + '</small></span>' +
        '<button class="shortcut-capture' + (active ? ' recording' : '') +
        '" data-shortcut="' + a.id + '" aria-label="Изменить: ' + esc(a.label) +
        '" aria-pressed="' + active + '">' +
        (active ? 'Нажми клавиши…' : '<kbd class="shortcut-keys">' + esc(formatShortcut(key)) + '</kbd>') +
        '</button></div>'
    }).join('')
    const reset = root.querySelector('#st-shortcuts-reset')
    if (reset) reset.disabled = busy
    const hint = root.querySelector('#st-shortcuts-hint')
    if (hint) hint.textContent = capture
      ? 'Нажми сочетание. Esc — отмена, Backspace или Delete — убрать назначение.'
      : 'Нажми на сочетание, чтобы изменить его. Буквы и цифры назначаются с Ctrl или Alt; F1–F12 можно отдельно.'
  }

  async function persist (next) {
    busy = true
    try {
      const success = await save(next)
      if (!success) toast('Не удалось сохранить сочетание', 'err')
    } finally {
      busy = false
      capture = ''
      paint()
    }
  }

  const onClick = e => {
    const btn = e.target.closest('[data-shortcut]')
    if (!btn || busy) return
    capture = capture === btn.dataset.shortcut ? '' : btn.dataset.shortcut
    recording = !!capture
    paint()
  }

  const onCapture = e => {
    if (!capture) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      capture = ''
      recording = false
      paint()
      return
    }
    if (['Backspace', 'Delete'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      e.stopImmediatePropagation()
      const id = capture
      recording = false
      persist({ ...bindings(), [id]: '' })
      return
    }
    const combo = shortcutFromEvent(e)
    if (!combo) return // Ожидаем завершённое сочетание, а не один модификатор.
    e.preventDefault()
    e.stopImmediatePropagation()
    if (!validShortcut(combo)) {
      toast('Это сочетание недоступно. Используй Ctrl/Alt с клавишей или F1–F12.', 'err')
      return
    }
    const already = SHORTCUT_ACTIONS.find(a => a.id !== capture && bindings()[a.id] === combo)
    if (already) {
      toast('Сочетание уже используется: ' + already.label, 'err')
      return
    }
    const id = capture
    recording = false
    persist({ ...bindings(), [id]: combo })
  }

  const reset = root.querySelector('#st-shortcuts-reset')
  const onReset = () => {
    if (busy) return
    capture = ''
    recording = false
    persist({ ...DEFAULT_SHORTCUTS })
  }
  box.addEventListener('click', onClick)
  reset.addEventListener('click', onReset)
  document.addEventListener('keydown', onCapture, true)
  paint()
  return () => {
    recording = false
    box.removeEventListener('click', onClick)
    reset.removeEventListener('click', onReset)
    document.removeEventListener('keydown', onCapture, true)
  }
}
