// Top-down car artwork, painted with canvas so every car can have any colour. Cars face right (+x), centred on (0, 0).
// The car names are generic (no brand names or logos), but each body is modelled on a real kind of car.
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
export const shade = (c, amt) => { const [r, g, b] = hex(c); const f = (v) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)))); return `rgb(${f(r)},${f(g)},${f(b)})` }

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }
// a symmetric body outline from half-widths along the length: [[x, halfWidth], ...] from rear to front
function bodyPath(ctx, prof) {
  ctx.beginPath()
  ctx.moveTo(prof[0][0], -prof[0][1])
  for (let i = 1; i < prof.length; i++) { const [x0, y0] = prof[i - 1], [x1, y1] = prof[i], mx = (x0 + x1) / 2; ctx.bezierCurveTo(mx, -y0, mx, -y1, x1, -y1) }
  for (let i = prof.length - 1; i > 0; i--) { const [x0, y0] = prof[i], [x1, y1] = prof[i - 1], mx = (x0 + x1) / 2; ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1) }
  ctx.closePath()
}
const glass = (ctx, pts) => {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath()
  const g = ctx.createLinearGradient(0, -8, 0, 8); g.addColorStop(0, '#1b2a3a'); g.addColorStop(0.5, '#3b5670'); g.addColorStop(1, '#14202c')
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke()
}
const wheel = (ctx, x, y, w = 9, h = 4.6, white = false) => { ctx.fillStyle = '#0c0c0e'; rr(ctx, x - w / 2, y - h / 2, w, h, 1.6); ctx.fill(); ctx.fillStyle = white ? '#e8e8e8' : '#3a3a40'; rr(ctx, x - w / 2 + 1.6, y - h / 2 + .8, w - 3.2, h - 1.6, 1); ctx.fill() }
const lights = (ctx, fx, fy, rx, ry, big = 2.2) => {
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fffbe0'; ctx.beginPath(); ctx.ellipse(fx, s * fy, big, big * 0.7, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#c1121f'; rr(ctx, rx - 1, s * ry - 1.5, 2, 3, 0.8); ctx.fill()
  }
}

const DRAW = {
  veloce(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 14, s * 10.2, 9, 4.8); wheel(ctx, -13, s * 10.6, 10, 5.4) }
    ctx.fillStyle = '#15151a'; rr(ctx, -26, -11, 4, 22, 1); ctx.fill()                                     // rear wing
    const prof = [[-23, 7.5], [-21, 10.6], [-8, 11.2], [4, 9.6], [15, 7.8], [24, 3.6], [25.4, 0]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    glass(ctx, [[-6, -6.4], [4, -5.4], [8, -4.4], [8, 4.4], [4, 5.4], [-6, 6.4], [-8, 4], [-8, -4]])
    ctx.strokeStyle = shade(c, -0.35); ctx.lineWidth = 0.7; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-18 + i * 2.6, -5); ctx.lineTo(-18 + i * 2.6, 5); ctx.stroke() }
    ctx.fillStyle = shade(c, -0.2); ctx.beginPath(); ctx.moveTo(11, -3.2); ctx.lineTo(20, -1.6); ctx.lineTo(20, 1.6); ctx.lineTo(11, 3.2); ctx.fill()
    lights(ctx, 21.5, 5.4, -22.5, 8, 1.6)
  },
  coupe(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 14.5, s * 10, 9, 4.6); wheel(ctx, -13.5, s * 10.4, 9.6, 5) }
    const prof = [[-23, 6.8], [-21.5, 10.2], [-12, 11], [0, 10.4], [14, 9.4], [22, 7.2], [24.6, 3.4], [25, 0]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    glass(ctx, [[-9, -6.6], [1, -6.2], [6, -4.8], [6, 4.8], [1, 6.2], [-9, 6.6], [-12, 4.2], [-12, -4.2]])
    ctx.fillStyle = shade(c, 0.18); ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(-18, -3.4); ctx.lineTo(-18, 3.4); ctx.lineTo(-12, 4); ctx.fill()
    ctx.fillStyle = shade(c, -0.15); rr(ctx, 9, -2.2, 10, 4.4, 2); ctx.fill()
    lights(ctx, 22.4, 7, -22.2, 8.6, 2.1)
  },
  muscle(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 15, s * 10.4, 9.4, 4.8); wheel(ctx, -14.5, s * 10.6, 10.4, 5.4) }
    const prof = [[-25, 9], [-24, 11.2], [-8, 11.4], [10, 11], [22, 10], [26, 8.6], [26.6, 0]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    ctx.fillStyle = 'rgba(255,255,255,.88)'; rr(ctx, -24, -3.4, 49, 2.5, 0.6); ctx.fill(); rr(ctx, -24, 0.9, 49, 2.5, 0.6); ctx.fill()   // racing stripes
    glass(ctx, [[-10, -7.6], [-1, -7.4], [3, -6], [3, 6], [-1, 7.4], [-10, 7.6], [-13, 5], [-13, -5]])
    ctx.fillStyle = '#101014'; rr(ctx, 12, -3.6, 8, 7.2, 1.6); ctx.fill()                               // hood scoop
    lights(ctx, 25.4, 8.8, -24.4, 9.6, 2.2)
  },
  hatch(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 12.5, s * 10, 8.6, 4.4); wheel(ctx, -12, s * 10, 8.6, 4.4) }
    const prof = [[-21, 8.4], [-20, 10.6], [-6, 11], [8, 10.8], [18, 10], [22, 7.6], [22.8, 0]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    ctx.fillStyle = shade(c, 0.12); rr(ctx, -9, -7.6, 15, 15.2, 3); ctx.fill()                           // roof
    glass(ctx, [[6, -7.4], [11, -7], [11, 7], [6, 7.4]]); glass(ctx, [[-13, -6.8], [-9.6, -7.2], [-9.6, 7.2], [-13, 6.8]])
    ctx.fillStyle = '#15151a'; rr(ctx, -21, -9.2, 3, 18.4, 1); ctx.fill()                                // roof spoiler
    ctx.fillStyle = shade(c, -0.2); rr(ctx, 12, -2, 8, 4, 1.4); ctx.fill()
    lights(ctx, 20.8, 7.4, -20.4, 9, 2)
  },
  rally(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 13, s * 10.4, 9.6, 5.2); wheel(ctx, -12.5, s * 10.4, 9.6, 5.2) }
    const prof = [[-22, 9.2], [-21, 11], [-6, 11.4], [10, 11], [20, 10.2], [23.6, 7.6], [24.2, 0]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(-22, -2.2); ctx.lineTo(24, -1); ctx.lineTo(24, 1); ctx.lineTo(-22, 2.2); ctx.fill()
    glass(ctx, [[-10, -7.4], [-2, -7.2], [5, -6.4], [5, 6.4], [-2, 7.2], [-10, 7.4], [-13, 5], [-13, -5]])
    ctx.fillStyle = '#0e0e12'; rr(ctx, -2, -2.6, 5, 5.2, 1.4); ctx.fill()                                  // roof scoop
    ctx.fillStyle = shade(c, -0.1); ctx.strokeStyle = '#0e0e12'; ctx.lineWidth = 0.8; rr(ctx, -25, -11.6, 5, 23.2, 1); ctx.fill(); ctx.stroke()   // big wing
    ctx.fillStyle = '#ffe66d'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(21.5, s * 3.6, 1.4, 0, 7); ctx.fill() }   // spot lamps
    lights(ctx, 23, 8, -21.6, 9.4, 1.8)
  },
  pickup(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 16, s * 11, 10.4, 5.2); wheel(ctx, -15, s * 11, 10.4, 5.2) }
    const prof = [[-27, 10], [-26, 11.8], [-4, 12], [14, 11.8], [25, 10.6], [28, 8.6], [28.6, 0]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    ctx.fillStyle = '#26262c'; rr(ctx, -25.5, -9.6, 18.5, 19.2, 1.4); ctx.fill()                            // open load bed
    ctx.strokeStyle = '#4a4a52'; ctx.lineWidth = 0.7; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-23 + i * 3.6, -9); ctx.lineTo(-23 + i * 3.6, 9); ctx.stroke() }
    ctx.fillStyle = shade(c, 0.1); rr(ctx, -6, -10.6, 15, 21.2, 3); ctx.fill(); outline(ctx)
    glass(ctx, [[1, -8.4], [6, -8], [6, 8], [1, 8.4]]); glass(ctx, [[-4.4, -7.6], [-2, -7.8], [-2, 7.8], [-4.4, 7.6]])
    ctx.fillStyle = '#ffe66d'; for (const s of [-3, -1, 1, 3]) { ctx.beginPath(); ctx.arc(8.4, s * 2.2, 0.9, 0, 7); ctx.fill() }
    lights(ctx, 27, 8.4, -26.6, 9.4, 2.2)
  },
  formula(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 16, s * 12.6, 10, 6.4); wheel(ctx, -14.5, s * 12.6, 11.4, 7.4) }
    ctx.fillStyle = shade(c, -0.1); rr(ctx, 21, -13.6, 5, 27.2, 1.4); ctx.fill(); outline(ctx)                // front wing
    ctx.fillStyle = '#16161c'; rr(ctx, -27.4, -13.4, 6, 26.8, 1.4); ctx.fill()                               // rear wing
    ctx.fillStyle = shade(c, -0.1); rr(ctx, -27.4, -13.4, 2.4, 26.8, 1); ctx.fill()
    const prof = [[-22, 3.6], [-14, 6], [-2, 6.2], [8, 3.6], [20, 1.8], [23, 1.2]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    ctx.fillStyle = shade(c, -0.15); rr(ctx, -6, -9, 10, 18, 3); ctx.fill(); outline(ctx)                     // sidepods
    ctx.fillStyle = '#0b0b0f'; ctx.beginPath(); ctx.ellipse(1, 0, 4.2, 2.8, 0, 0, 7); ctx.fill()              // cockpit
    ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.arc(1, 0, 1.9, 0, 7); ctx.fill()                         // helmet
    ctx.strokeStyle = '#16161c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-2.4, -3.6); ctx.quadraticCurveTo(5, 0, -2.4, 3.6); ctx.stroke()   // halo
  },
  classic(ctx, c) {
    for (const s of [-1, 1]) { wheel(ctx, 14.5, s * 10, 8.6, 4.2, true); wheel(ctx, -14, s * 10, 8.6, 4.2, true) }
    const prof = [[-23, 7], [-22, 10.2], [-6, 10.8], [8, 9.4], [20, 8.6], [24, 6], [25, 0]]
    bodyPath(ctx, prof); fill(ctx, c); outline(ctx)
    ctx.fillStyle = '#7a4b2a'; rr(ctx, -10, -6.6, 10, 13.2, 3); ctx.fill()                                   // open cockpit with leather seats
    ctx.fillStyle = '#5e381f'; rr(ctx, -9, -6, 3, 5.2, 1); ctx.fill(); rr(ctx, -9, 0.8, 3, 5.2, 1); ctx.fill()
    glass(ctx, [[1.6, -7.6], [3.6, -7.2], [3.6, 7.2], [1.6, 7.6]])
    ctx.strokeStyle = shade(c, 0.5); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(22, 0); ctx.stroke()
    ctx.fillStyle = '#d9d9de'; rr(ctx, 23.2, -7, 2.2, 14, 1); ctx.fill(); rr(ctx, -25, -6.6, 2.2, 13.2, 1); ctx.fill()    // chrome bumpers
    lights(ctx, 21.8, 7.2, -21.4, 8.8, 2.4)
  },
}
function fill(ctx, c) {
  const g = ctx.createLinearGradient(0, -12, 0, 12); g.addColorStop(0, shade(c, 0.28)); g.addColorStop(0.45, c); g.addColorStop(1, shade(c, -0.32))
  ctx.fillStyle = g; ctx.fill()
}
function outline(ctx) { ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke() }

const cache = new Map()
// returns a canvas (resolution `px` pixels per world unit) with the car painted on it
export function carSprite(id, color, px = 4) {
  const key = `${id}|${color}|${px}`
  if (cache.has(key)) return cache.get(key)
  const W = 64, H = 34, cv = document.createElement('canvas')
  cv.width = Math.round(W * px); cv.height = Math.round(H * px)
  const ctx = cv.getContext('2d')
  ctx.scale(px, px); ctx.translate(W / 2, H / 2)
  ctx.save(); ctx.filter = 'blur(2px)'; ctx.fillStyle = 'rgba(0,0,0,.35)'; rr(ctx, -25 + 2, -11 + 3, 52, 22, 6); ctx.fill(); ctx.restore()      // soft shadow
  ;(DRAW[id] || DRAW.coupe)(ctx, color)
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.ellipse(0, -5, 18, 2.2, 0, 0, 7); ctx.fill()                               // light reflection
  cache.set(key, cv)
  return cv
}
export const SPRITE_UNITS = { w: 64, h: 34 }
