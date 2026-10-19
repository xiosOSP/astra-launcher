// Рисует иконку приложения (пиксельная звезда) в PNG и ICO без сторонних графических библиотек.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const STAR = [
  '.....#.....',
  '....###....',
  '....###....',
  '###########',
  '.#########.',
  '..#######..',
  '...#####...',
  '..###.###..',
  '..##...##..',
  '.##.....##.',
  '.#.......#.'
]

function crc32 (buf) {
  let c; const table = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => {
    c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0
  }))
  let crc = 0xFFFFFFFF
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function png (size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ])
}

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]

function draw (size) {
  const buf = Buffer.alloc(size * size * 4)
  const set = (x, y, c) => { const o = (y * size + x) * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = c[3] }
  const r = size * 0.2 // скругление фона
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - 1 - r); const cy = Math.min(Math.max(y, r), size - 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue
      const t = y / size
      set(x, y, [Math.round(32 - t * 14), Math.round(14 - t * 6), Math.round(16 - t * 6), 255])
    }
  }
  const cell = Math.floor(size * 0.72 / 11)
  const off = Math.floor((size - cell * 11) / 2)
  STAR.forEach((row, gy) => [...row].forEach((ch, gx) => {
    if (ch !== '#') return
    const light = gx + gy < 7
    const dark = gx + gy > 14 || (gy > 6 && (gx < 3 || gx > 7))
    const c = hex(light ? '#ff6a5a' : dark ? '#9c171c' : '#e0262b')
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) set(off + gx * cell + x, off + gy * cell + y, c)
  }))
  return png(size, buf)
}

async function main () {
  const out = path.join(__dirname, '..', 'build')
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'icon.png'), draw(512))
  const pngToIco = require('png-to-ico').default || require('png-to-ico')
  const ico = await pngToIco([256, 128, 64, 48, 32, 16].map(draw))
  fs.writeFileSync(path.join(out, 'icon.ico'), ico)
  console.log('build/icon.png и build/icon.ico готовы')
}
main()
