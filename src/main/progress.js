'use strict'
// Единый прогресс запуска: одна шкала от 0 до 100 % на всю подготовку игры.
// Проценты считаются по реальным байтам, никогда не идут назад и отправляются
// в интерфейс не чаще 8 раз в секунду — поэтому полоса движется плавно.

const MB = 1048576

function fmtMb (bytes) {
  const v = bytes / MB
  return (v < 10 ? v.toFixed(1) : Math.round(v).toString()).replace('.', ',')
}

function fmtEta (sec) {
  if (sec < 60) return `~${Math.max(1, Math.round(sec))} с`
  return `~${Math.round(sec / 60)} мин`
}

class Progress {
  constructor (emit) {
    this.emit = emit // (patch) => void
    this.reset()
  }

  reset () {
    this.total = 0
    this.done = 0
    this.inflight = new Map()
    this.base = 0
    this.span = 100
    this.shown = 0
    this.stage = ''
    this.detailMode = 'none' // none | count | bytes
    this.count = { cur: 0, total: 0 }
    this.samples = []
    this.lastEmit = 0
    clearTimeout(this.timer)
    this.timer = null
  }

  // Участок общей шкалы, который занимает текущая фаза.
  range (base, span) {
    this.base = base
    this.span = span
    this.total = 0
    this.done = 0
    this.inflight.clear()
    this.samples = []
  }

  // quiet — скрыть строку с мегабайтами (например, пока распаковывается Java).
  setStage (stage, quiet = false) {
    this.stage = stage
    this.quiet = quiet
    this.flush(true)
  }

  // ----- фаза «проверка»: по количеству файлов -----
  countStart (total, stage) {
    this.quiet = false
    this.detailMode = 'count'
    this.count = { cur: 0, total }
    this.stage = stage
    this.flush(true)
  }

  countTick (n = 1) {
    this.count.cur += n
    this.schedule()
  }

  // ----- фаза «загрузка»: по байтам -----
  bytesStart (total, stage) {
    this.quiet = false
    this.detailMode = 'bytes'
    this.total = total
    this.done = 0
    this.inflight.clear()
    this.samples = [{ t: Date.now(), b: 0 }]
    this.stage = stage
    this.flush(true)
  }

  // Размер файла оказался не таким, как ожидали (например, у библиотек Fabric его нет заранее).
  adjustTotal (delta) {
    this.total = Math.max(this.done, this.total + delta)
  }

  partial (key, bytes) {
    this.inflight.set(key, bytes)
    this.schedule()
  }

  fileDone (key, bytes) {
    this.inflight.delete(key)
    this.done += bytes
    this.schedule()
  }

  fileRetry (key) {
    this.inflight.delete(key)
  }

  current () {
    let cur = this.done
    for (const v of this.inflight.values()) cur += v
    return cur
  }

  fraction () {
    if (this.detailMode === 'count') return this.count.total ? this.count.cur / this.count.total : 1
    if (this.detailMode === 'bytes') return this.total ? Math.min(1, this.current() / this.total) : 1
    return 0
  }

  speed () {
    const now = Date.now()
    const cur = this.current()
    this.samples.push({ t: now, b: cur })
    while (this.samples.length > 2 && now - this.samples[0].t > 4000) this.samples.shift()
    const first = this.samples[0]
    const dt = (now - first.t) / 1000
    return dt >= 1 ? (cur - first.b) / dt : 0
  }

  detail () {
    if (this.quiet) return ''
    if (this.detailMode === 'count' && this.count.total) {
      return `${this.count.cur} из ${this.count.total}`
    }
    if (this.detailMode === 'bytes' && this.total) {
      const cur = this.current()
      const parts = [`${fmtMb(cur)} из ${fmtMb(this.total)} МБ`]
      const sp = this.speed()
      if (sp > 50 * 1024) {
        parts.push(`${fmtMb(sp)} МБ/с`)
        const left = (this.total - cur) / sp
        if (left > 2) parts.push(`осталось ${fmtEta(left)}`)
      }
      return parts.join(' · ')
    }
    return ''
  }

  schedule () {
    if (this.timer) return
    const wait = Math.max(0, 125 - (Date.now() - this.lastEmit))
    this.timer = setTimeout(() => { this.timer = null; this.flush() }, wait)
  }

  flush (force = false) {
    if (!force && Date.now() - this.lastEmit < 100) return this.schedule()
    clearTimeout(this.timer)
    this.timer = null
    this.lastEmit = Date.now()
    const pct = this.base + this.span * this.fraction()
    this.shown = Math.max(this.shown, Math.min(100, pct))
    this.emit({ stage: this.stage, percent: Math.floor(this.shown), detail: this.detail() })
  }

  // Подготовка закончена — шкала заполнена.
  complete (stage) {
    this.shown = 100
    this.detailMode = 'none'
    this.stage = stage
    clearTimeout(this.timer)
    this.timer = null
    this.lastEmit = Date.now()
    this.emit({ stage, percent: 100, detail: '' })
  }
}

module.exports = { Progress, fmtMb }
