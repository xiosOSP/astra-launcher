'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { SHORTCUT_DEFAULTS, validShortcut, sanitizeShortcuts } = require('../src/main/shortcuts')

test('all default bindings are valid and unique', () => {
  const entries = Object.values(SHORTCUT_DEFAULTS)
  assert.equal(new Set(entries).size, entries.length)
  entries.forEach(combo => assert.equal(validShortcut(combo), true, combo))
})

test('accepts canonical modifier combinations and function keys', () => {
  for (const combo of ['F1', 'F12', 'Ctrl+KeyK', 'Ctrl+Shift+Digit5', 'Alt+Enter', 'Ctrl+Alt+Shift+KeyZ']) {
    assert.equal(validShortcut(combo), true, combo)
  }
})

test('rejects conflicting system shortcuts and malformed inputs', () => {
  for (const combo of ['', 'KeyP', 'Shift+KeyP', 'Ctrl+KeyR', 'Ctrl+Shift+KeyI',
    'Alt+F4', 'Alt+Space', 'Ctrl+Ctrl+KeyP', 'Shift+Ctrl+KeyP',
    'Cmd+KeyQ', 'F13', 'Ctrl+Tab', 'Ctrl+Delete', 'Ctrl+KeyFoo',
    5, null, {}, 'Ctrl+KeyK+KeyP']) {
    assert.equal(validShortcut(combo), false, String(combo))
  }
})

test('missing settings get defaults', () => {
  assert.deepEqual(sanitizeShortcuts(null), SHORTCUT_DEFAULTS)
  assert.deepEqual(sanitizeShortcuts({}), SHORTCUT_DEFAULTS)
})

test('custom assignments persist; an empty assignment disables its action', () => {
  const modified = sanitizeShortcuts({ home: 'Alt+KeyH', play: '', help: 'F2' })
  assert.equal(modified.home, 'Alt+KeyH')
  assert.equal(modified.play, '')
  assert.equal(modified.help, 'F2')
  assert.equal(modified.library, SHORTCUT_DEFAULTS.library)
})

test('duplicate combinations never execute multiple actions', () => {
  const sanitized = sanitizeShortcuts({ home: 'Ctrl+Digit2', library: 'Ctrl+Digit2' })
  assert.equal(sanitized.home, 'Ctrl+Digit2')
  assert.equal(sanitized.library, '')
  const assigned = Object.values(sanitized).filter(Boolean)
  assert.equal(new Set(assigned).size, assigned.length)
})

test('rejects unsupported fields and invalid custom shortcuts', () => {
  const s = sanitizeShortcuts({ home: 'Ctrl+KeyR', play: false, evil: 'Ctrl+KeyK' })
  assert.equal(s.home, SHORTCUT_DEFAULTS.home)
  assert.equal(s.play, SHORTCUT_DEFAULTS.play)
  assert.equal(Object.hasOwn(s, 'evil'), false)
})
