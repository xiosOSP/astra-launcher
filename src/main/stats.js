'use strict'
// Статистика: сколько наиграно в каждой сборке, сколько запусков, когда последний раз.
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const file = () => path.join(app.getPath('userData'), 'stats.json')
let cache = null

function load () {
  if (cache) return cache
  try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { cache = {} }
  if (!cache || typeof cache !== 'object') cache = {}
  return cache
}

function save () {
  const tmp = file() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
  fs.renameSync(tmp, file())
}

const key = p => p.pack ? `pack:${p.pack}` : `${p.version}|${p.loader}`

function record (profile, { playedMs = 0, launch = false } = {}) {
  const all = load()
  const k = key(profile)
  const e = all[k] || { playMs: 0, launches: 0, lastPlayed: 0 }
  e.playMs += Math.max(0, Math.round(playedMs))
  if (launch) e.launches += 1
  e.lastPlayed = Date.now()
  all[k] = e
  try { save() } catch {}
}

function get () {
  const all = load()
  const total = Object.values(all).reduce((n, e) => n + (e.playMs || 0), 0)
  return { byProfile: all, totalMs: total }
}

module.exports = { record, get }
