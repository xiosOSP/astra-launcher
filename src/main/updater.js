'use strict'
// Автообновление portable-версии через релизы GitHub.
// В каждом релизе лежат AstraLauncher-Portable-X.Y.Z.exe и update.json
// ({ version, file, size, sha256 }). Новый файл скачивается рядом со старым,
// сверяется по SHA-256, затем маленький скрипт PowerShell ждёт закрытия
// лаунчера, удаляет старый .exe и запускает новый.
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { app, shell } = require('electron')
const { fetchJson, download, abortAll, MOCK } = require('./net')

const { GITHUB_REPO: REPO } = require('./config')
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

const { newer, label, FILE_RE } = require('./appversion')

// Путь к запущенному portable-файлу (его выставляет обёртка electron-builder).
function portableExe () {
  const p = process.env.PORTABLE_EXECUTABLE_FILE
  return p && fs.existsSync(p) ? p : null
}

// Убираем из описания релиза разметку Markdown — в окне показываем простой текст.
function plainNotes (body) {
  return String(body || '')
    .replace(/\r/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
    .slice(0, 4000)
}

let state = { status: 'idle' } // idle | checking | available | none | downloading | ready | error
let info = null
let readyFile = null
let emit = () => {}

function set (patch) {
  state = { ...state, ...patch }
  emit(state)
}

function setEmitter (fn) { emit = fn }
function getState () { return state }

async function check () {
  if (state.status === 'downloading') return state
  set({ status: 'checking', error: null })
  try {
    let rel
    if (MOCK) {
      if (process.env.ASTRA_MOCK_UPDATE !== '1') { set({ status: 'none', checkedAt: Date.now() }); return state }
      rel = { tag_name: process.env.ASTRA_MOCK_UPDATE_TAG || 'v0.2.0-v1', body: '## Что нового\n- **Проверка** обновлений\n- Мелкие исправления', assets: [{ name: 'update.json', browser_download_url: 'https://github.com/mock/update.json' }] }
    } else {
      rel = await fetchJson(RELEASES_API)
    }
    const version = String(rel.tag_name || '').replace(/^v/, '')
    if (!newer(version, app.getVersion())) {
      set({ status: 'none', checkedAt: Date.now(), latest: label(version || app.getVersion()) })
      return state
    }
    const manifestAsset = (rel.assets || []).find(a => a.name === 'update.json')
    if (!manifestAsset) throw new Error('В релизе нет файла update.json')
    const manifest = MOCK
      ? { version, file: `AstraLauncher-Portable-${version}.exe`, size: 100e6, sha256: null }
      : await fetchJson(manifestAsset.browser_download_url)
    const exeAsset = (rel.assets || []).find(a => a.name === manifest.file)
    if (!MOCK && !exeAsset) throw new Error('В релизе нет файла лаунчера')
    if (!FILE_RE.test(manifest.file)) throw new Error('Неожиданное имя файла обновления')
    if (manifest.version && manifest.version !== version) throw new Error('Версия в update.json не совпадает с релизом')
    info = {
      version,
      notes: plainNotes(rel.body),
      file: manifest.file,
      size: manifest.size || (exeAsset && exeAsset.size) || 0,
      sha256: manifest.sha256 || null,
      url: exeAsset ? exeAsset.browser_download_url : 'https://github.com/mock/file.exe'
    }
    set({ status: 'available', version, versionLabel: label(version), notes: info.notes, size: info.size, canInstall: !!portableExe() || MOCK, checkedAt: Date.now() })
  } catch (e) {
    set({ status: 'error', error: e.message, checkedAt: Date.now() })
  }
  return state
}

async function downloadUpdate () {
  if (!info) throw new Error('Сначала проверь обновления')
  const current = portableExe()
  if (!current && !MOCK) {
    // Не portable (например, запуск из исходников) — просто открываем страницу релиза.
    shell.openExternal(RELEASES_PAGE)
    return state
  }
  if (!info.sha256 && !MOCK) throw new Error('У обновления нет контрольной суммы — скачай его вручную со страницы релиза')
  const dir = current ? path.dirname(current) : app.getPath('temp')
  const target = path.join(dir, info.file)
  set({ status: 'downloading', percent: 0, error: null })
  try {
    await download(info.url, target, {
      group: 'update',
      hash: info.sha256 ? { algo: 'sha256', value: info.sha256 } : null,
      onProgress: (cur, total) => set({ status: 'downloading', percent: Math.floor((cur / (total || info.size || 1)) * 100) })
    })
    readyFile = target
    set({ status: 'ready', percent: 100 })
  } catch (e) {
    set({ status: 'error', error: e.message })
    throw e
  }
  return state
}

function cancel () {
  abortAll('update')
}

function psQuote (s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

// Перезапуск в новую версию. PowerShell получает скрипт в UTF-16 (base64),
// поэтому пути с кириллицей не ломаются.
function installAndRestart () {
  if (!readyFile) throw new Error('Обновление ещё не скачано')
  const current = portableExe()
  if (MOCK || !current || process.platform !== 'win32') {
    set({ status: 'idle' })
    return false
  }
  const script = [
    `$old = ${psQuote(current)}`,
    `$new = ${psQuote(readyFile)}`,
    `try { Wait-Process -Id ${process.pid} -Timeout 60 -ErrorAction SilentlyContinue } catch {}`,
    'if ($old -ne $new) {',
    '  for ($i = 0; $i -lt 120; $i++) {',
    '    try { Remove-Item -LiteralPath $old -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 }',
    '  }',
    '}',
    'Start-Process -FilePath $new'
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  setTimeout(() => app.quit(), 300)
  return true
}

module.exports = { check, downloadUpdate, installAndRestart, cancel, getState, setEmitter, newer, RELEASES_PAGE }
