'use strict'
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { fetchJson, MOCK } = require('./net')
const settings = require('./settings')

const runtimeDir = () => path.join(settings.gameDir(), 'runtime')

function osName () {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

function archName () {
  if (process.arch === 'arm64') return 'aarch64'
  if (process.arch === 'ia32') return 'x32'
  return 'x64'
}

function requiredJava (versionJson) {
  return (versionJson && versionJson.javaVersion && versionJson.javaVersion.majorVersion) || 8
}

// Ищет исполняемый файл java внутри распакованного архива.
function findJavaBin (dir) {
  const names = process.platform === 'win32' ? ['javaw.exe', 'java.exe'] : ['java']
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    if (path.basename(cur) === 'bin') {
      for (const n of names) {
        if (entries.some(e => e.isFile() && e.name === n)) return path.join(cur, n)
      }
    }
    for (const e of entries) if (e.isDirectory()) stack.push(path.join(cur, e.name))
  }
  return null
}

function testJava (bin) {
  return new Promise(resolve => {
    // javaw.exe не печатает версию — для проверки берём java.exe рядом.
    const probe = bin.endsWith('javaw.exe') ? bin.replace(/javaw\.exe$/, 'java.exe') : bin
    execFile(probe, ['-version'], { timeout: 15000, windowsHide: true }, (err, _out, stderr) => {
      if (err) return resolve(null)
      const m = /version "([^"]+)"/.exec(stderr || '')
      resolve(m ? m[1] : 'unknown')
    })
  })
}

function majorOf (versionString) {
  if (!versionString) return 0
  const parts = versionString.split(/[._-]/).map(Number)
  return parts[0] === 1 ? parts[1] : parts[0]
}

async function fetchRelease (major) {
  const base = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot`
  const tries = [
    { arch: archName(), image: 'jre' },
    { arch: archName(), image: 'jdk' },
    // Java 8 для Mac на Apple Silicon нет — берём x64 (работает через Rosetta).
    ...(archName() === 'aarch64' ? [{ arch: 'x64', image: 'jre' }, { arch: 'x64', image: 'jdk' }] : [])
  ]
  for (const t of tries) {
    const list = await fetchJson(`${base}?os=${osName()}&architecture=${t.arch}&image_type=${t.image}&vendor=eclipse`)
    if (Array.isArray(list) && list.length && list[0].binary && list[0].binary.package) return list[0]
  }
  throw new Error(`Не нашёл Java ${major} для этой системы`)
}

async function extract (archive, dest) {
  fs.mkdirSync(dest, { recursive: true })
  if (archive.endsWith('.zip')) {
    const extractZip = require('extract-zip')
    await extractZip(archive, { dir: path.resolve(dest) })
  } else {
    const tar = require('tar')
    await tar.x({ file: archive, cwd: dest })
  }
}

// Minecraft 1.17 просит Java 16, но сборок Temurin 16 JRE почти нет — 17 подходит полностью.
function normalizeMajor (major) {
  return major === 16 ? 17 : major
}

function javaDir (major) {
  return path.join(runtimeDir(), `java-${major}`)
}

function installedJava (major) {
  const dir = javaDir(major)
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, '.astra-java.json'), 'utf8'))
    const bin = path.join(dir, saved.bin)
    if (fs.existsSync(bin) || (MOCK && saved.bin === 'mock')) return MOCK ? process.execPath : bin
  } catch {}
  return null
}

/**
 * Что нужно сделать, чтобы появилась Java нужной версии.
 * { ready: '<путь>' } — уже есть; иначе описание архива для общей очереди загрузки.
 */
async function planJava (major) {
  major = normalizeMajor(major)
  const ready = installedJava(major)
  if (ready) return { ready }
  const release = await fetchRelease(major)
  const pkg = release.binary.package
  return {
    major,
    release: release.release_name || '',
    url: pkg.link,
    size: pkg.size || 0,
    sha256: pkg.checksum || null,
    archive: path.join(runtimeDir(), path.basename(pkg.name))
  }
}

// Распаковывает скачанный архив и проверяет, что Java запускается.
async function installJava (plan) {
  const dir = javaDir(plan.major)
  const marker = path.join(dir, '.astra-java.json')
  if (MOCK) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(marker, JSON.stringify({ bin: 'mock' }))
    fs.rmSync(plan.archive, { force: true })
    return process.execPath
  }
  fs.rmSync(dir, { recursive: true, force: true })
  await extract(plan.archive, dir)
  fs.rmSync(plan.archive, { force: true })

  const bin = findJavaBin(dir)
  if (!bin) throw new Error('В архиве Java не нашлось исполняемого файла')
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755)
  const version = await testJava(bin)
  if (!version) throw new Error('Скачанная Java не запускается')
  if (majorOf(version) !== plan.major && version !== 'unknown') {
    throw new Error(`Скачалась не та Java: ${version}`)
  }
  fs.writeFileSync(marker, JSON.stringify({ bin: path.relative(dir, bin), version, release: plan.release }))
  return bin
}

module.exports = { planJava, installJava, requiredJava, testJava, majorOf, extract, findJavaBin }
