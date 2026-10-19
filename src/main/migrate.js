'use strict'
// Перенос из TLauncher или официального лаунчера (папка .minecraft):
// миры, скриншоты, ресурспаки, шейдеры, список серверов и настройки управления.
// Файлы копируются — в старой папке ничего не меняется и не удаляется.
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { normalize, instanceDir } = require('./profiles')
const { worldName, inside } = require('./paths')
const sharedopts = require('./sharedopts')

function defaultDir () {
  if (process.env.ASTRA_MIGRATE_DIR) return process.env.ASTRA_MIGRATE_DIR
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft')
  return path.join(os.homedir(), '.minecraft')
}

// ---------- level.dat: версия игры, в которой мир сохранён ----------
// Минимальный разбор NBT: нам нужно только Data.Version.Name и Data.LevelName.
function readNbt (buf) {
  let o = 0
  const u8 = () => buf.readUInt8(o++)
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v }
  const u16 = () => { const v = buf.readUInt16BE(o); o += 2; return v }
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v }
  const str = () => { const n = u16(); const v = buf.toString('utf8', o, o + n); o += n; return v }
  const payload = (t, depth) => {
    if (depth > 64) throw new Error('nbt depth')
    switch (t) {
      case 1: return u8()
      case 2: return i16()
      case 3: return i32()
      case 4: o += 8; return null
      case 5: o += 4; return null
      case 6: o += 8; return null
      case 7: { const n = i32(); o += n; return null }
      case 8: return str()
      case 9: { const et = u8(); const n = i32(); const arr = []; for (let i = 0; i < n; i++) arr.push(payload(et, depth + 1)); return arr }
      case 10: {
        const obj = {}
        for (;;) {
          const tt = u8()
          if (tt === 0) break
          const name = str()
          obj[name] = payload(tt, depth + 1)
        }
        return obj
      }
      case 11: { const n = i32(); o += n * 4; return null }
      case 12: { const n = i32(); o += n * 8; return null }
      default: throw new Error('nbt tag ' + t)
    }
  }
  const t = u8()
  if (t !== 10) throw new Error('not nbt')
  str()
  return payload(10, 0)
}

function worldInfo (dir) {
  try {
    let buf = fs.readFileSync(path.join(dir, 'level.dat'))
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf)
    const data = (readNbt(buf) || {}).Data || {}
    return { version: (data.Version && typeof data.Version.Name === 'string') ? data.Version.Name : null, levelName: typeof data.LevelName === 'string' ? data.LevelName : null }
  } catch { return { version: null, levelName: null } }
}

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

function listNames (dir, filter) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(filter).map(e => e.name) } catch { return [] }
}

/** Что можно перенести из папки dir (по умолчанию .minecraft). null — папки нет. */
function detect (dir = defaultDir()) {
  dir = path.resolve(String(dir))
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null
  const saves = path.join(dir, 'saves')
  const worlds = listNames(saves, e => e.isDirectory() && fs.existsSync(path.join(saves, e.name, 'level.dat')))
    .map(name => {
      const w = path.join(saves, name)
      let lastPlayed = 0
      try { lastPlayed = fs.statSync(path.join(w, 'level.dat')).mtimeMs } catch {}
      return { name, size: dirSize(w), lastPlayed, ...worldInfo(w) }
    })
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
  const shots = listNames(path.join(dir, 'screenshots'), e => e.isFile() && /\.(png|jpe?g)$/i.test(e.name))
  const rps = listNames(path.join(dir, 'resourcepacks'), e => (e.isFile() && /\.zip$/i.test(e.name)) || e.isDirectory())
  const shaders = listNames(path.join(dir, 'shaderpacks'), e => (e.isFile() && /\.zip$/i.test(e.name)) || e.isDirectory())
  const options = fs.existsSync(path.join(dir, 'options.txt'))
  const servers = fs.existsSync(path.join(dir, 'servers.dat'))
  const tlauncher = fs.existsSync(path.join(dir, 'TlauncherProfiles.json')) || listNames(dir, e => /tlauncher/i.test(e.name)).length > 0
  const empty = !worlds.length && !shots.length && !rps.length && !shaders.length && !options && !servers
  if (empty) return null
  return { dir, from: tlauncher ? 'TLauncher' : 'Minecraft', worlds, screenshots: shots.length, resourcepacks: rps.length, shaderpacks: shaders.length, options, servers }
}

// Свободное имя в папке: «Мир», «Мир (2)», …
function freeName (dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name
  for (let i = 2; i < 1000; i++) {
    const n = `${name} (${i})`
    if (!fs.existsSync(path.join(dir, n))) return n
  }
  throw new Error('Не нашёл свободное имя для ' + name)
}

/**
 * Перенос. what: { worlds: [имена], screenshots, resourcepacks, shaderpacks, options, servers }.
 * onProgress({ done, total, stage }). Возвращает, что перенесено.
 */
async function run ({ dir, target, what = {} }, onProgress = () => {}) {
  const info = detect(dir)
  if (!info) throw new Error('В этой папке нечего переносить')
  const profile = normalize(target)
  const inst = instanceDir(profile, true)
  const src = info.dir
  const okName = n => { try { worldName(n); return true } catch { return false } }
  const worlds = (Array.isArray(what.worlds) ? what.worlds : []).map(String).filter(n => okName(n) && info.worlds.some(w => w.name === n))
  const jobs = []
  for (const name of worlds) jobs.push({ kind: 'world', name })
  for (const kind of ['screenshots', 'resourcepacks', 'shaderpacks']) if (what[kind]) jobs.push({ kind })
  if (what.servers && info.servers) jobs.push({ kind: 'servers' })
  if (what.options && info.options) jobs.push({ kind: 'options' })
  const res = { worlds: [], screenshots: 0, resourcepacks: 0, shaderpacks: 0, servers: false, options: false }
  let done = 0
  const tick = stage => onProgress({ current: done, total: jobs.length, stage })
  for (const job of jobs) {
    if (job.kind === 'world') {
      tick(`Копирую мир «${job.name}»`)
      const saves = path.join(inst, 'saves')
      fs.mkdirSync(saves, { recursive: true })
      // Этот же мир уже переносили и с тех пор в нём не играли — второй копии не делаем.
      const from = inside(path.join(src, 'saves'), job.name)
      const mt = f => { try { return Math.round(fs.statSync(path.join(f, 'level.dat')).mtimeMs / 1000) } catch { return -1 } }
      if (fs.existsSync(path.join(saves, job.name)) && mt(path.join(saves, job.name)) === mt(from)) { res.skipped = (res.skipped || 0) + 1; done++; continue }
      const to = freeName(saves, job.name)
      await fs.promises.cp(from, inside(saves, to), { recursive: true, preserveTimestamps: true, filter: s => path.basename(s) !== 'session.lock' })
      res.worlds.push(to)
    } else if (['screenshots', 'resourcepacks', 'shaderpacks'].includes(job.kind)) {
      tick(job.kind === 'screenshots' ? 'Копирую скриншоты' : job.kind === 'resourcepacks' ? 'Копирую ресурспаки' : 'Копирую шейдеры')
      const from = path.join(src, job.kind)
      const to = path.join(inst, job.kind)
      fs.mkdirSync(to, { recursive: true })
      for (const name of listNames(from, () => true)) {
        if (fs.existsSync(path.join(to, name))) continue // такой файл уже есть — не дублируем
        await fs.promises.cp(path.join(from, name), path.join(to, name), { recursive: true })
        res[job.kind]++
      }
    } else if (job.kind === 'servers') {
      tick('Переношу список серверов')
      const to = path.join(inst, 'servers.dat')
      if (!fs.existsSync(to)) { fs.copyFileSync(path.join(src, 'servers.dat'), to); res.servers = true }
    } else if (job.kind === 'options') {
      tick('Переношу управление и звук')
      // Управление станет общим для всех версий, а в новую сборку файл кладём целиком.
      sharedopts.seedFrom(path.join(src, 'options.txt'))
      const to = path.join(inst, 'options.txt')
      if (!fs.existsSync(to)) fs.copyFileSync(path.join(src, 'options.txt'), to)
      res.options = true
    }
    done++
  }
  tick('Готово')
  return res
}

module.exports = { detect, run, defaultDir, worldInfo, readNbt }
