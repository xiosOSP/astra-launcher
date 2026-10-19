'use strict'
const fs = require('fs')
const path = require('path')
const { instancesDir } = require('./profiles')
const { inside, safeName } = require('./paths')

const IMG = /\.(png|jpe?g)$/i

function list () {
  const base = instancesDir()
  if (!fs.existsSync(base)) return []
  const out = []
  for (const inst of fs.readdirSync(base, { withFileTypes: true })) {
    if (!inst.isDirectory()) continue
    const dir = path.join(base, inst.name, 'screenshots')
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (!IMG.test(f)) continue
      try {
        const st = fs.statSync(path.join(dir, f))
        out.push({
          instance: inst.name,
          file: f,
          mtime: st.mtimeMs,
          size: st.size,
          url: `app://shots/${encodeURIComponent(inst.name)}/${encodeURIComponent(f)}`
        })
      } catch {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

// Путь к скриншоту с проверкой: только внутри instances/<имя>/screenshots.
function resolve (instance, file) {
  safeName(instance)
  const name = path.basename(String(file))
  if (!IMG.test(name)) throw new Error('Не изображение')
  return inside(path.join(instancesDir(), instance, 'screenshots'), name)
}

function remove ({ instance, file }) {
  fs.rmSync(resolve(instance, file), { force: true })
  return true
}

module.exports = { list, resolve, remove }
