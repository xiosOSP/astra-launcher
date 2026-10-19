// Изометрические пиксельные блоки, логотип-звезда и запасной аватар — всё рисуется кодом.
import { rng } from './scene.js'

const TEX = {
  grass: {
    top: ['#5fa83a', '#4e9a2f', '#6cbf44', '#3f8a2a'],
    side: ['#8a5a3a', '#7a4e30', '#9a6844', '#6b4229'],
    fringe: ['#5fa83a', '#4e9a2f', '#3f8a2a']
  },
  crimson: {
    top: ['#b3242d', '#951b23', '#cc3039', '#7c141b'],
    side: ['#6e2424', '#5a1c1c', '#7f2b2b', '#4c1717'],
    fringe: ['#b3242d', '#951b23']
  },
  stone: {
    top: ['#8a8a8a', '#7a7a7a', '#969696', '#666666'],
    side: ['#7d7d7d', '#6e6e6e', '#8a8a8a', '#5c5c5c']
  },
  planks: {
    top: ['#b08a52', '#a07c46', '#bf9860', '#8d6b3a'],
    side: ['#a8834f', '#97743f', '#b8925a', '#7d5e33'],
    lines: '#6e5230'
  }
}

function shade (hexColor, k) {
  const n = parseInt(hexColor.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * k)
  const g = Math.round(((n >> 8) & 255) * k)
  const b = Math.round((n & 255) * k)
  return `rgb(${r},${g},${b})`
}

function texel (tex, face, i, j, r) {
  const t = TEX[tex]
  if (face !== 'top') {
    if (t.fringe && (j === 0 || (j === 1 && r() > 0.45) || (j === 2 && r() > 0.85))) return t.fringe[Math.floor(r() * t.fringe.length)]
    if (t.lines && (j === 3 || j === 7)) return t.lines
  }
  const pal = face === 'top' ? t.top : t.side
  return pal[Math.floor(r() * pal.length)]
}

/** SVG-строка изометрического блока 8×8 на грань. */
export function blockSvg (tex = 'grass', seed = 7) {
  const r = rng(seed)
  const N = 8; const a = 4; const b = 2
  const polys = []
  const P = {
    top: (i, j) => [32 + (i - j) * a, (i + j) * b],
    left: (i, k) => [i * a, 16 + i * b + k * a],
    right: (i, k) => [32 + i * a, 32 - i * b + k * a]
  }
  const K = { top: 1, left: 0.78, right: 0.6 }
  for (const face of ['top', 'left', 'right']) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const f = P[face]
        const pts = [f(i, j), f(i + 1, j), f(i + 1, j + 1), f(i, j + 1)].map(p => p.join(',')).join(' ')
        const col = shade(texel(tex, face, i, j, r), K[face])
        polys.push(`<polygon points="${pts}" fill="${col}" stroke="${col}" stroke-width="0.35"/>`)
      }
    }
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true" class="iso-block">${polys.join('')}</svg>`
}

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

/** Пиксельная звезда — знак AstraLauncher. */
export function starSvg (size = 40) {
  const rects = []
  STAR.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch !== '#') return
      const light = x + y < 7
      const dark = x + y > 14 || (y > 6 && (x < 3 || x > 7))
      const fill = light ? '#ff6a5a' : dark ? '#9c171c' : '#e0262b'
      rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`)
    })
  })
  return `<svg viewBox="0 0 11 11" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</svg>`
}

function hash (str) {
  let h = 2166136261
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Запасной аватар 8×8 по нику (если скин не загрузился). */
export function avatarSvg (nick = '?') {
  const r = rng(hash(nick || '?'))
  const skins = ['#e0a98a', '#c98d6b', '#a8704f', '#7d4f36', '#f1c2a2']
  const hairs = ['#2b1a12', '#5a3420', '#c9a24a', '#8e2a1e', '#1d1d24', '#d8d0c4', '#7a1d4a']
  const eyes = ['#3a7bd5', '#2e8b57', '#6b3e26', '#8b2be2', '#c81d18']
  const skin = skins[Math.floor(r() * skins.length)]
  const hair = hairs[Math.floor(r() * hairs.length)]
  const eye = eyes[Math.floor(r() * eyes.length)]
  const px = []
  const put = (x, y, c) => px.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x, y, skin)
  const fringe = 1 + Math.floor(r() * 2)
  for (let y = 0; y < fringe + 1; y++) for (let x = 0; x < 8; x++) if (y < fringe || r() > 0.5) put(x, y, hair)
  for (let y = 0; y < 5; y++) { put(0, y, hair); put(7, y, hair) }
  put(1, 4, '#ffffff'); put(2, 4, eye); put(5, 4, eye); put(6, 4, '#ffffff')
  put(3, 6, shade(skin, 0.7)); put(4, 6, shade(skin, 0.7))
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${px.join('')}</svg>`
}
