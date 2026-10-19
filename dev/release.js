// Готовит файлы релиза: dist/update.json с размером и SHA-256 portable-файла.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const pkg = require('../package.json')
const file = `AstraLauncher-Portable-${pkg.version}.exe`
const full = path.join(__dirname, '..', 'dist', file)
const data = fs.readFileSync(full)
const manifest = { version: pkg.version, file, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'update.json'), JSON.stringify(manifest, null, 2))
console.log(manifest)
