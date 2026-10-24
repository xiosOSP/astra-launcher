'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

// settings.js only needs Electron's userData path; tests use an isolated directory.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-settings-test-'))
const originalLoad = Module._load
let settings
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => dataDir } }
    return originalLoad.call(this, request, parent, isMain)
  }
  settings = require('../src/main/settings')
} finally {
  Module._load = originalLoad
}

test('renderer settings changes can pass through the IPC allowlist', () => {
  assert.ok(settings.ALLOWED_PATCH_FIELDS.includes('shortcuts'))
  assert.ok(settings.ALLOWED_PATCH_FIELDS.includes('nickname'))
})

test('custom shortcuts persist in settings.json', () => {
  const original = settings.load()
  assert.equal(original.shortcuts.home, 'Ctrl+Digit1')
  const changed = settings.save({
    nickname: 'AstraTest',
    shortcuts: { ...original.shortcuts, home: 'Alt+KeyH', play: '' }
  })
  assert.equal(changed.shortcuts.home, 'Alt+KeyH')
  assert.equal(changed.shortcuts.play, '')
  const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
  assert.equal(disk.shortcuts.home, 'Alt+KeyH')
  assert.equal(disk.shortcuts.play, '')
  assert.equal(disk.nickname, 'AstraTest')
})

test('malformed duplicate shortcuts are sanitized before saving', () => {
  const previous = settings.load().shortcuts
  const changed = settings.save({ shortcuts: { ...previous, home: 'Ctrl+Digit2', library: 'Ctrl+Digit2' } })
  assert.equal(changed.shortcuts.home, 'Ctrl+Digit2')
  assert.equal(changed.shortcuts.library, '')
})

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
