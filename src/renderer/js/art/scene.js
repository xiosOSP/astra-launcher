// Пиксельные сцены для баннера. Всё рисуется кодом в низком разрешении
// и растягивается без сглаживания (image-rendering: pixelated).

export function rng (seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16)

function rect (ctx, x, y, w, h, c) {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

// Градиент неба с дизерингом (как в старых играх), без размытых переходов.
function ditherSky (ctx, W, H, stops) {
  const img = ctx.createImageData(W, H)
  const cols = stops.map(([p, c]) => [p, hex(c)])
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1)
    let i = 0
    while (i < cols.length - 2 && t > cols[i + 1][0]) i++
    const [p0, c0] = cols[i]
    const [p1, c1] = cols[i + 1]
    const f = Math.min(1, Math.max(0, (t - p0) / (p1 - p0 || 1)))
    for (let x = 0; x < W; x++) {
      const c = f > BAYER[(y & 3) * 4 + (x & 3)] ? c1 : c0
      const o = (y * W + x) * 4
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

// Ступенчатый рельеф: возвращает высоту для каждого x.
function ridge (ctx, W, H, r, { base, amp, minStep, maxStep, color, clampTop = 0 }) {
  const heights = new Array(W)
  let y = base
  let x = 0
  while (x < W) {
    const w = minStep + Math.floor(r() * (maxStep - minStep + 1))
    y += Math.round((r() - 0.5) * amp)
    y = Math.max(clampTop, Math.min(H - 2, Math.max(base - amp * 1.5, Math.min(base + amp * 1.5, y))))
    rect(ctx, x, y, w, H - y, color)
    for (let i = x; i < Math.min(W, x + w); i++) heights[i] = y
    x += w
  }
  return heights
}

function glow (ctx, x, y, radius, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
  const [r, gg, b] = hex(color)
  g.addColorStop(0, `rgba(${r},${gg},${b},${alpha})`)
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`)
  ctx.fillStyle = g
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

// ---------------- Сцена 1: крепость в Нижнем мире ----------------
function nether (W, H) {
  const r = rng(1337)
  const bg = document.createElement('canvas')
  bg.width = W; bg.height = H
  const c = bg.getContext('2d')
  ditherSky(c, W, H, [[0, '#0d0506'], [0.35, '#2a0a0c'], [0.62, '#5c1412'], [0.8, '#8a2316'], [1, '#3a0b0b']])

  // Кровавое солнце — квадратное кольцо за крепостью.
  const ss = Math.max(12, Math.round(H * 0.17))
  const sx = Math.round(W * 0.7); const sy = Math.round(H * 0.1)
  glow(c, sx + ss / 2, sy + ss / 2, ss * 3.2, '#ff2a1f', 0.4)
  rect(c, sx - 1, sy - 1, ss + 2, ss + 2, '#7d1210')
  rect(c, sx, sy, ss, ss, '#ff3b2f')
  rect(c, sx + 2, sy + 2, ss - 4, ss - 4, '#d4221c')
  rect(c, sx + Math.round(ss * 0.32), sy + Math.round(ss * 0.32), Math.round(ss * 0.36), Math.round(ss * 0.36), '#5c0d0c')

  ridge(c, W, H, r, { base: H * 0.58, amp: 6, minStep: 3, maxStep: 7, color: '#3b0e0f' })
  ridge(c, W, H, r, { base: H * 0.68, amp: 6, minStep: 2, maxStep: 6, color: '#270809' })

  // Крепость справа.
  const ground = Math.round(H * 0.76)
  const cx = Math.round(W * 0.52)
  const cw = Math.round(W * 0.4)
  const unit = Math.max(1, Math.round(H / 72))
  const wallC = '#1a0607'; const rim = '#4a1012'
  const windows = []
  const wallTop = ground - Math.round(H * 0.16)
  rect(c, cx, wallTop, cw, ground - wallTop + 6, wallC)
  for (let x = cx; x < cx + cw; x += 2 * unit) rect(c, x, wallTop - unit, unit, unit, wallC)
  const towers = [[0.0, 6, 0.42], [0.13, 4, 0.3], [0.27, 9, 0.6], [0.45, 5, 0.38], [0.58, 8, 0.52], [0.76, 5, 0.34], [0.9, 7, 0.46]]
  for (const [fx, tw, th] of towers) {
    const x = Math.round(cx + cw * fx); const w = tw * unit; const h = th * H * 0.62
    const top = Math.round(ground - h)
    rect(c, x, top, w, ground - top + 4, wallC)
    rect(c, x + w - unit, top, unit, ground - top, rim) // подсветка от солнца
    if (r() > 0.45) {
      // шпиль ступеньками
      let sw = w; let sy2 = top
      while (sw > unit) { sy2 -= unit * 2; rect(c, x + (w - sw) / 2, sy2, sw, unit * 2, wallC); sw -= unit * 2 }
    } else {
      for (let i = 0; i < w; i += 2 * unit) rect(c, x + i, top - 2 * unit, unit, 2 * unit, wallC)
    }
    for (let wy = top + 4 * unit; wy < wallTop - 2 * unit; wy += 6 * unit) {
      if (r() > 0.35) windows.push({ x: x + Math.floor(w / 2 - unit / 2), y: wy, w: unit, h: 2 * unit, p: r() * 6 })
    }
  }
  // Ворота и окна стены.
  rect(c, cx + Math.round(cw * 0.36), ground - 7 * unit, 5 * unit, 7 * unit, '#0a0203')
  for (let x = cx + 3 * unit; x < cx + cw - 3 * unit; x += 9 * unit) {
    if (r() > 0.5) windows.push({ x, y: wallTop + 4 * unit, w: unit, h: 2 * unit, p: r() * 6 })
  }
  // Мост с арками к крепости.
  const bridgeY = ground - 4 * unit
  rect(c, cx - Math.round(W * 0.14), bridgeY, Math.round(W * 0.14), 2 * unit, wallC)
  for (let x = cx - Math.round(W * 0.14); x < cx; x += 9 * unit) rect(c, x + 3 * unit, bridgeY, 2 * unit, H, wallC)

  // Передний план рисуем отдельно — поверх лавы.
  const fg = document.createElement('canvas')
  fg.width = W; fg.height = H
  const f = fg.getContext('2d')
  const lavaTop = Math.round(H * 0.87)
  // Берега спускаются к лаве ступеньками, без вертикальных обрывов.
  function shore (fromX, width, base, dir) {
    const hs = []
    let step = 0; let y = base
    for (let i = 0; i < width; i++) {
      if (step <= 0) {
        const t = i / width // 0 у края экрана → 1 у лавы
        y = Math.round(base + Math.pow(t, 2.2) * (H - base + 2) + (r() - 0.5) * 2)
        step = 3 + Math.floor(r() * 4)
      }
      step--
      const x = dir > 0 ? fromX + i : fromX - i
      hs[dir > 0 ? i : width - 1 - i] = y
      rect(f, x, y, 1, H - y, '#110304')
      rect(f, x, y, 1, 1, '#4a1210') // кромка подсвечена лавой
    }
    return hs
  }
  const sw = Math.round(W * 0.32)
  const left = shore(0, sw, Math.round(H * 0.8), 1)
  const right = shore(W - 1, sw, Math.round(H * 0.79), -1)
  const rightStart = W - sw

  // Лавопады со стены крепости.
  const falls = [
    { x: cx + Math.round(cw * 0.2), y0: wallTop + 6 * unit, y1: lavaTop, w: 2 * unit },
    { x: cx + Math.round(cw * 0.68), y0: wallTop + 9 * unit, y1: lavaTop, w: unit + 1 },
  ]

  // Путник в плаще на правом берегу.
  const u = unit
  const fx = Math.round(W * 0.86); const fy = right[fx - rightStart] || Math.round(H * 0.8)
  rect(f, fx, fy - 9 * u, 3 * u, 3 * u, '#0a0203')
  rect(f, fx, fy - 6 * u, 3 * u, 4 * u, '#0a0203')
  rect(f, fx - 2 * u, fy - 6 * u, 2 * u, 5 * u, '#2a0607')
  rect(f, fx - 3 * u, fy - 3 * u, u, 2 * u, '#2a0607')
  rect(f, fx, fy - 2 * u, u, 2 * u, '#0a0203'); rect(f, fx + 2 * u, fy - 2 * u, u, 2 * u, '#0a0203')
  for (let i = 0; i < 4; i++) rect(f, fx + 3 * u + i * u, fy - 5 * u - i * u, u, u, '#9a8b88')

  return {
    bg,
    fg,
    lavaTop,
    falls,
    windows,
    embers: Array.from({ length: Math.round(W / 5) }, () => spawnEmber(r, W, H, lavaTop, true)),
    r
  }
}

function spawnEmber (r, W, H, from, anywhere) {
  return {
    x: r() * W,
    y: anywhere ? r() * H : from + r() * (H - from),
    vy: 0.15 + r() * 0.35,
    vx: (r() - 0.5) * 0.15,
    life: 0.4 + r() * 0.6
  }
}

function drawLava (ctx, W, H, top, t) {
  for (let y = top; y < H; y++) {
    const depth = (y - top) / Math.max(1, H - top)
    for (let x = 0; x < W; x += 2) {
      const n = Math.sin(x * 0.19 + t * 1.2 + y * 0.8) + Math.sin(x * 0.05 - t * 0.6) * 0.8 - depth * 0.6
      ctx.fillStyle = n > 1.5 ? '#ffb24a' : n > 0.95 ? '#ff7a2a' : n > 0.2 ? '#cf3a13' : n > -0.7 ? '#9a1f0d' : '#6a130a'
      ctx.fillRect(x, y, 2, 1)
    }
  }
}

function frameNether (ctx, s, W, H, t) {
  ctx.drawImage(s.bg, 0, 0)
  // окна мерцают
  for (const w of s.windows) {
    const on = Math.sin(t * 2 + w.p) > -0.6
    rect(ctx, w.x, w.y, w.w, w.h, on ? '#ff8a3d' : '#a8331a')
  }
  // лавопады — полосы бегут вниз
  for (const f of s.falls) {
    for (let y = Math.round(f.y0); y < f.y1; y++) {
      const k = Math.floor((y - t * 18) / 2) & 3
      rect(ctx, f.x, y, f.w, 1, k === 0 ? '#ffb24a' : k === 1 ? '#ff8a3d' : '#ff5a1f')
    }
  }
  drawLava(ctx, W, H, s.lavaTop, t)
  ctx.drawImage(s.fg, 0, 0)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  glow(ctx, W * 0.55, H, H * 0.55, '#ff3a1a', 0.14)
  ctx.restore()
  drawEmbers(ctx, s, W, H, s.lavaTop)
}

function drawEmbers (ctx, s, W, H, from, color = ['#ffb24a', '#ff6a3d', '#c81d18']) {
  for (const e of s.embers) {
    e.y -= e.vy; e.x += e.vx + Math.sin(e.y * 0.08) * 0.05
    e.life -= 0.004
    if (e.y < 0 || e.life <= 0) Object.assign(e, spawnEmber(s.r, W, H, from, false))
    const c = e.life > 0.6 ? color[0] : e.life > 0.3 ? color[1] : color[2]
    rect(ctx, e.x, e.y, 1, 1, c)
  }
}

// ---------------- Сцена 2: ночь, лагерь у костра ----------------
function night (W, H) {
  const r = rng(4242)
  const bg = document.createElement('canvas')
  bg.width = W; bg.height = H
  const c = bg.getContext('2d')
  ditherSky(c, W, H, [[0, '#070304'], [0.45, '#1a0709'], [0.75, '#3d0f12'], [1, '#160506']])
  const stars = Array.from({ length: Math.round(W * 0.35) }, () => ({ x: Math.floor(r() * W), y: Math.floor(r() * H * 0.55), p: r() * 6, b: r() }))

  const mx = Math.round(W * 0.68); const my = Math.round(H * 0.12); const ms = Math.max(12, Math.round(H * 0.16))
  glow(c, mx + ms / 2, my + ms / 2, ms * 2.6, '#ff6a5a', 0.22)
  rect(c, mx, my, ms, ms, '#ffb0a3')
  rect(c, mx + 2, my + 3, 3, 3, '#e8877a'); rect(c, mx + ms - 6, my + ms - 7, 4, 4, '#e8877a'); rect(c, mx + ms / 2, my + 2, 2, 2, '#e8877a')

  ridge(c, W, H, r, { base: H * 0.5, amp: 10, minStep: 3, maxStep: 8, color: '#2b0a0d' })
  const mid = ridge(c, W, H, r, { base: H * 0.68, amp: 6, minStep: 4, maxStep: 9, color: '#180507' })

  // ёлки ступеньками
  const unit = Math.max(1, Math.round(H / 64))
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * W); const base = mid[x] || H * 0.7
    const th = (6 + Math.floor(r() * 8)) * unit
    for (let k = 0; k < th; k += unit) {
      const w = Math.max(unit, Math.round(((k / th) * 7 + 1) * unit) | 0)
      rect(c, x - w / 2, base - th + k, w, unit, '#0f0304')
    }
  }
  const groundY = Math.round(H * 0.84)
  rect(c, 0, groundY, W, H - groundY, '#0b0203')
  for (let x = 0; x < W; x += 2) if (r() > 0.6) rect(c, x, groundY - 1, 1, 1, '#0b0203')

  // домик
  const hx = Math.round(W * 0.78); const hw = 22 * unit; const hh = 12 * unit
  rect(c, hx, groundY - hh, hw, hh, '#1e0708')
  for (let k = 0; k < 8; k++) rect(c, hx - unit + k * unit, groundY - hh - (k + 1) * unit, hw + 2 * unit - k * 2 * unit, unit, '#2a0a0c')
  const windows = [{ x: hx + 4 * unit, y: groundY - 8 * unit, w: 4 * unit, h: 4 * unit, p: 1 }, { x: hx + 14 * unit, y: groundY - 8 * unit, w: 4 * unit, h: 4 * unit, p: 3 }]

  const fire = { x: Math.round(W * 0.62), y: groundY }
  rect(c, fire.x - 4 * unit, groundY - unit, 8 * unit, unit, '#3a1a10')
  return { bg, stars, windows, fire, unit, groundY, embers: Array.from({ length: 24 }, () => ({ x: fire.x, y: groundY, vy: 0.3, vx: 0, life: Math.random() })), r }
}

function frameNight (ctx, s, W, H, t) {
  ctx.drawImage(s.bg, 0, 0)
  for (const st of s.stars) {
    const tw = Math.sin(t * 1.7 + st.p)
    if (tw > -0.3) rect(ctx, st.x, st.y, 1, 1, st.b > 0.85 && tw > 0.6 ? '#ffe3dc' : '#8a5a58')
  }
  for (const w of s.windows) rect(ctx, w.x, w.y, w.w, w.h, Math.sin(t * 3 + w.p) > -0.8 ? '#ff9a4a' : '#d9682e')
  const u = s.unit; const f = s.fire
  ctx.save(); ctx.globalCompositeOperation = 'lighter'
  glow(ctx, f.x, f.y - 3 * u, 26 * u, '#ff5a1f', 0.28 + Math.sin(t * 9) * 0.04)
  ctx.restore()
  const flick = [3, 5, 4, 6, 3][Math.floor(t * 10) % 5]
  rect(ctx, f.x - 2 * u, f.y - (flick + 1) * u, 4 * u, flick * u, '#ff5a1f')
  rect(ctx, f.x - u, f.y - (flick + 2) * u, 2 * u, flick * u, '#ffb24a')
  rect(ctx, f.x, f.y - (flick + 3) * u, u, 2 * u, '#ffe08a')
  for (const e of s.embers) {
    e.y -= 0.35 + e.life * 0.2; e.x += Math.sin((e.y + e.life * 50) * 0.15) * 0.25
    e.life -= 0.01
    if (e.life <= 0 || e.y < f.y - 40 * u) Object.assign(e, { x: f.x + (s.r() - 0.5) * 4 * u, y: f.y - 4 * u, life: 0.6 + s.r() * 0.4 })
    rect(ctx, e.x, e.y, 1, 1, e.life > 0.5 ? '#ffb24a' : '#c81d18')
  }
}

// ---------------- Сцена 3: пещера с кристаллами ----------------
function cave (W, H) {
  const r = rng(9001)
  const bg = document.createElement('canvas')
  bg.width = W; bg.height = H
  const c = bg.getContext('2d')
  ditherSky(c, W, H, [[0, '#0e0506'], [0.5, '#1d080a'], [1, '#0b0304']])
  // фактура камня
  for (let i = 0; i < W * H * 0.06; i++) rect(c, Math.floor(r() * W), Math.floor(r() * H), 2, 1, r() > 0.5 ? '#25090b' : '#140405')
  // дальняя стена пещеры и проём со светом
  ridge(c, W, H, r, { base: H * 0.55, amp: 8, minStep: 3, maxStep: 7, color: '#1f0809' })
  const unit = Math.max(1, Math.round(H / 50))
  // сталактиты сверху
  for (let x = 0; x < W; x += 4 + Math.floor(r() * 7)) {
    const len = Math.floor(H * (0.06 + r() * 0.22))
    let w = (2 + Math.floor(r() * 3)) * unit
    for (let y = 0; y < len; y += unit) {
      rect(c, x, y, w, unit, '#2a0b0d')
      rect(c, x, y, unit, unit, '#3b1013')
      if (r() > 0.7 && w > unit) w -= unit
    }
  }
  // каменный пол уступами с подсвеченной кромкой
  const floor = ridge(c, W, H, r, { base: H * 0.78, amp: 5, minStep: 4, maxStep: 9, color: '#170506' })
  for (let x = 0; x < W; x++) rect(c, x, floor[x], 1, unit, '#3a0f12')
  const crystals = []
  for (let i = 0; i < Math.round(W / 22); i++) {
    const x = Math.floor(r() * W); const base = floor[x] || H * 0.78
    const n = 2 + Math.floor(r() * 3)
    for (let k = 0; k < n; k++) {
      const h = (4 + Math.floor(r() * (k === 1 ? 14 : 8))) * unit
      crystals.push({ x: x + k * 3 * unit, y: base - h, w: 2 * unit, h, p: r() * 6, u: unit })
    }
  }
  return { bg, crystals, river: Math.round(H * 0.9), r, embers: Array.from({ length: 30 }, () => spawnEmber(r, W, H, H * 0.9, true)) }
}

function frameCave (ctx, s, W, H, t) {
  ctx.drawImage(s.bg, 0, 0)
  ctx.save(); ctx.globalCompositeOperation = 'lighter'
  for (const k of s.crystals) if (k.h > 8) glow(ctx, k.x, k.y + k.h / 2, k.h * 1.6, '#ff2a3f', 0.05 + Math.sin(t * 1.5 + k.p) * 0.03)
  ctx.restore()
  for (const k of s.crystals) {
    const b = Math.sin(t * 1.5 + k.p) > 0
    const u = k.u
    // тело кристалла: светлая левая грань, тёмная правая, острый кончик
    rect(ctx, k.x, k.y + u, u, k.h - u, b ? '#ff6f80' : '#f0475d')
    rect(ctx, k.x + u, k.y + u, u, k.h - u, b ? '#c81d38' : '#a3172e')
    rect(ctx, k.x, k.y, u, u, '#ffc2ca')
  }
  for (let y = s.river; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      const n = Math.sin((x - t * 14) * 0.18 + y) + Math.sin(x * 0.05 + t) * 0.8
      rect(ctx, x, y, 2, 1, n > 1.4 ? '#ffb24a' : n > 0.7 ? '#ff7a2a' : n > -0.2 ? '#c8340f' : n > -0.9 ? '#8a1d0c' : '#5e1209')
    }
  }
  drawEmbers(ctx, s, W, H, s.river, ['#ff9aa6', '#ff3b4f', '#8a1626'])
}

const KINDS = {
  nether: [nether, frameNether],
  night: [night, frameNight],
  cave: [cave, frameCave]
}

/**
 * Привязывает сцену к canvas. Размер пикселя подбирается по высоте,
 * анимация ~15 кадров/с, на паузе вне экрана и при reduced motion.
 */
export function mountScene (canvas, kind, { pixel } = {}) {
  const ctx = canvas.getContext('2d')
  let state = null; let W = 0; let H = 0; let raf = 0; let last = 0; let visible = true
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const t0 = performance.now()

  function layout () {
    const box = canvas.parentElement.getBoundingClientRect()
    if (!box.width || !box.height) return
    const p = pixel || Math.max(2, Math.round(box.height / 110))
    W = Math.ceil(box.width / p); H = Math.ceil(box.height / p)
    canvas.width = W; canvas.height = H
    canvas.style.width = W * p + 'px'; canvas.style.height = H * p + 'px'
    ctx.imageSmoothingEnabled = false
    state = KINDS[kind][0](W, H)
    draw(performance.now())
  }

  function draw (now) {
    if (!state) return
    KINDS[kind][1](ctx, state, W, H, (now - t0) / 1000)
  }

  function loop (now) {
    raf = requestAnimationFrame(loop)
    if (!visible || document.hidden || reduced.matches) return
    if (now - last < 66) return
    last = now
    draw(now)
  }

  const ro = new ResizeObserver(() => layout())
  ro.observe(canvas.parentElement)
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
  io.observe(canvas)
  layout()
  raf = requestAnimationFrame(loop)

  return {
    destroy () { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect() }
  }
}
