'use strict'
// Миры и их копии. Копия — zip-архив папки мира в instances/<сборка>/backups/<мир>/.
// Автокопии делаются после закрытия игры (пользователь ничего не ждёт), хранятся последние N.
const fs = require('fs')
const path = require('path')
const yazl = require('yazl')
const { instanceDir, subDir, instancesDir } = require('./profiles')
const { inside, safeName, worldName } = require('./paths')

const AUTO_MARK = ' (авто)'
const PRE_MARK = ' (до восстановления)'

function dirSize (dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else { try { total += fs.statSync(p).size } catch {} }
    }
  }
  return total
}

function backupsDir (profile, world) {
  return path.join(instanceDir(profile, true), 'backups', worldName(world))
}

function listBackups (profile, world) {
  const dir = backupsDir(profile, world)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.zip'))
    .map(f => {
      const st = fs.statSync(path.join(dir, f))
      return { file: f, size: st.size, time: st.mtimeMs, auto: f.includes(AUTO_MARK), kind: f.includes(AUTO_MARK) ? 'auto' : f.includes(PRE_MARK) ? 'pre' : 'manual' }
    })
    .sort((a, b) => b.time - a.time)
}

function list (profile) {
  const saves = subDir(profile, 'saves')
  if (!fs.existsSync(saves)) return []
  return fs.readdirSync(saves, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(saves, e.name, 'level.dat')))
    .map(e => {
      const dir = path.join(saves, e.name)
      let lastPlayed = 0
      try { lastPlayed = fs.statSync(path.join(dir, 'level.dat')).mtimeMs } catch {}
      const instName = path.basename(instanceDir(profile))
      return {
        name: e.name,
        lastPlayed,
        size: dirSize(dir),
        icon: fs.existsSync(path.join(dir, 'icon.png'))
          ? `app://worlds/${encodeURIComponent(instName)}/${encodeURIComponent(e.name)}/icon.png?t=${Math.round(lastPlayed)}`
          : null,
        backups: listBackups(profile, e.name)
      }
    })
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
}

function stamp () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

// Архивирует папку мира. session.lock пропускаем — он занят, пока мир открыт.
function zipFolder (src, dest) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const stack = ['']
    while (stack.length) {
      const rel = stack.pop()
      const abs = path.join(src, rel)
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) { stack.push(r); zip.addEmptyDirectory(r) } else if (e.name !== 'session.lock') zip.addFile(path.join(src, r), r)
      }
    }
    zip.end()
    const tmp = dest + '.part'
    const out = fs.createWriteStream(tmp)
    zip.outputStream.pipe(out)
    zip.outputStream.on('error', reject)
    out.on('error', reject)
    out.on('close', () => { fs.renameSync(tmp, dest); resolve(dest) })
  })
}

async function backup (profile, world, { auto = false, pre = false } = {}) {
  const saves = subDir(profile, 'saves')
  const src = inside(saves, worldName(world))
  if (!fs.existsSync(path.join(src, 'level.dat'))) throw new Error('Мир не найден')
  const dir = backupsDir(profile, world)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${world} ${stamp()}${auto ? AUTO_MARK : pre ? PRE_MARK : ''}.zip`)
  await zipFolder(src, dest)
  return path.basename(dest)
}

function removeBackup (profile, world, file) {
  const target = inside(backupsDir(profile, world), path.basename(String(file)))
  if (!target.endsWith('.zip')) throw new Error('Не архив')
  fs.rmSync(target, { force: true })
  return true
}

// Восстановление: сначала делаем копию текущего состояния, потом заменяем папку мира.
async function restore (profile, world, file) {
  const extractZip = require('extract-zip')
  const saves = subDir(profile, 'saves')
  const target = inside(saves, worldName(world))
  const zipFile = inside(backupsDir(profile, world), path.basename(String(file)))
  if (!fs.existsSync(zipFile)) throw new Error('Копия не найдена')
  if (fs.existsSync(path.join(target, 'level.dat'))) await backup(profile, world, { pre: true })
  const tmp = target + '.astra-restore'
  fs.rmSync(tmp, { recursive: true, force: true })
  await extractZip(zipFile, { dir: path.resolve(tmp) })
  if (!fs.existsSync(path.join(tmp, 'level.dat'))) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw new Error('В архиве нет мира')
  }
  const old = target + '.astra-old'
  fs.rmSync(old, { recursive: true, force: true })
  if (fs.existsSync(target)) fs.renameSync(target, old)
  try {
    fs.renameSync(tmp, target)
  } catch (e) {
    if (fs.existsSync(old)) fs.renameSync(old, target)
    throw e
  }
  fs.rmSync(old, { recursive: true, force: true })
  return true
}

// После игры: копируем миры, которые изменились с прошлой копии, и чистим старые автокопии.
async function autoBackup (profile, keep = 5) {
  const done = []
  for (const w of list(profile)) {
    const last = w.backups[0]
    if (last && last.time >= w.lastPlayed) continue
    try {
      await backup(profile, w.name, { auto: true })
      done.push(w.name)
      const autos = listBackups(profile, w.name).filter(b => b.auto)
      for (const old of autos.slice(keep)) removeBackup(profile, w.name, old.file)
    } catch {}
  }
  return done
}

// Путь к картинке мира для протокола app://worlds/<сборка>/<мир>/icon.png
function iconPath (instance, world) {
  safeName(instance)
  return inside(path.join(instancesDir(), instance, 'saves'), worldName(world), 'icon.png')
}

module.exports = { list, backup, restore, removeBackup, autoBackup, iconPath, backupsDir }
