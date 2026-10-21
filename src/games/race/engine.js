// Racing engine: tracks, driving physics and lap counting. Pure maths (no DOM), so it is easy to test.
// World units: 1 unit is about 0.6 m. Y points down. Angles are in radians (0 = pointing right).
export const CAR_LEN = 46, CAR_WID = 22
const STEP = 8                                 // distance between track samples
const TAU = Math.PI * 2
export const wrapAngle = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// ---- tracks: a closed smooth curve through control points, then resampled evenly ----
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  return [0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3))
}
export function buildTrack(def) {
  const P = def.points, n = P.length
  const dense = []
  for (let i = 0; i < n; i++) for (let j = 0; j < 24; j++) dense.push(catmull(P[(i - 1 + n) % n], P[i], P[(i + 1) % n], P[(i + 2) % n], j / 24))
  let len = 0
  for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i + 1) % dense.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]) }
  const k = (def.km * 1700) / len                            // scale the drawing so its length matches the real circuit
  const pts = dense.map(([x, y]) => [x * k, y * k])
  // resample to even spacing
  const out = []; let acc = 0, target = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (target <= acc + seg && out.length < 100000) { const t = seg ? (target - acc) / seg : 0; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); target += STEP }
    acc += seg
  }
  const N = out.length
  const x = new Float32Array(N), y = new Float32Array(N), tx = new Float32Array(N), ty = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    x[i] = out[i][0]; y[i] = out[i][1]
    const a = out[(i - 2 + N) % N], b = out[(i + 2) % N], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1
    tx[i] = dx / l; ty[i] = dy / l
  }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  for (let i = 0; i < N; i++) { minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]) }
  const width = def.width || 150
  return { id: def.id, name: def.name, country: def.country, km: def.km, theme: def.theme, width, N, x, y, tx, ty, length: N * STEP,
    bbox: { minX, minY, maxX, maxY }, wall: width / 2 + 70, def }
}

// nearest centreline sample to (px, py): searches near `hint` (fast and cannot jump across to another part of the track)
export function nearest(track, px, py, hint = -1) {
  const { N, x, y, tx, ty } = track
  let best = -1, bd = 1e18
  const scan = (from, count) => { for (let k = 0; k < count; k++) { const i = (from + k + N) % N, dx = px - x[i], dy = py - y[i], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i } } }
  if (hint >= 0) { scan(hint - 25, 90); if (bd > (track.width * 2.2) ** 2) { bd = 1e18; scan(0, N) } } else scan(0, N)
  const dx = px - x[best], dy = py - y[best]
  return { i: best, lat: dx * -ty[best] + dy * tx[best], dist: Math.sqrt(bd) }      // lat > 0 = right-hand side of the direction of travel
}

export function gridSlot(track, place) {            // where a car starts: behind the line, side by side
  const i = (track.N - 12 - place * 5 + track.N) % track.N
  const off = (place % 2 === 0 ? -1 : 1) * track.width * 0.2
  return { x: track.x[i] - track.ty[i] * off, y: track.y[i] + track.tx[i] * off, h: Math.atan2(track.ty[i], track.tx[i]), i }
}

/* ---- cars ---- */
export const CARS = {
  veloce:   { name: 'Veloce GT',      kind: 'Supercar',    blurb: 'Fastest on the straights, sharp but nervous.',      top: 345, acc: 205, brake: 430, turn: 2.35, grip: 6.2, off: 0.42 },
  coupe:    { name: 'Rennsport Coupe', kind: 'Sports coupe', blurb: 'Balanced and precise. Hard to beat.',               top: 322, acc: 190, brake: 420, turn: 2.55, grip: 7.0, off: 0.45 },
  muscle:   { name: 'Thunder V8',     kind: 'Muscle car',  blurb: 'Huge acceleration, slides in the corners.',         top: 330, acc: 235, brake: 380, turn: 2.05, grip: 4.9, off: 0.45 },
  hatch:    { name: 'Hot Hatch',      kind: 'Hot hatchback', blurb: 'Quick in the bends, lower top speed.',            top: 285, acc: 185, brake: 400, turn: 2.85, grip: 7.6, off: 0.5 },
  rally:    { name: 'Rally Evo',      kind: 'Rally car',   blurb: 'Grips on grass and gravel. Forgiving.',             top: 300, acc: 195, brake: 410, turn: 2.6, grip: 6.4, off: 0.78 },
  pickup:   { name: 'Ridge 4x4',      kind: 'Pickup truck', blurb: 'Heavy and tough, loves going off-road.',           top: 262, acc: 165, brake: 360, turn: 2.2, grip: 6.0, off: 0.82 },
  formula:  { name: 'Apex F1',        kind: 'Open-wheel',  blurb: 'Insane grip and braking, hates grass.',             top: 360, acc: 215, brake: 520, turn: 2.9, grip: 9.0, off: 0.32 },
  classic:  { name: 'Retro Roadster', kind: 'Classic',     blurb: 'Style over speed. A fun challenge.',                top: 255, acc: 150, brake: 340, turn: 2.45, grip: 5.4, off: 0.5 },
}
export const CAR_IDS = Object.keys(CARS)
export const COLORS = ['#e63946', '#f4a300', '#f1fa3b', '#2ec27e', '#1e90ff', '#7a5cff', '#ff5fa2', '#f2f2f2', '#2b2b33', '#ff7a1a']

export function newCar(track, place, carId = 'coupe') {
  const g = gridSlot(track, place), spec = CARS[carId] || CARS.coupe
  return { x: g.x, y: g.y, h: g.h, vx: 0, vy: 0, w: 0, steer: 0, spec, idx: g.i, lapsDone: -1, total: g.i - track.N, onGrass: false, lat: 0, finished: false, finishMs: 0, brake: false, drift: 0, hit: 0 }
}

// ---- one physics step. input = { gas: 0..1, brake: 0..1, steer: -1..1 } ----
export function stepCar(car, input, track, dt, others = []) {
  const s = car.spec
  const fx = Math.cos(car.h), fy = Math.sin(car.h)
  let vf = car.vx * fx + car.vy * fy, vl = -car.vx * fy + car.vy * fx
  const near = nearest(track, car.x, car.y, car.idx)
  const half = track.width / 2
  const off = Math.abs(near.lat) > half + 6
  car.onGrass = off; car.lat = near.lat
  const topNow = s.top * (off ? s.off : 1)
  // engine and brakes
  car.brake = false
  if (input.gas > 0) vf += s.acc * input.gas * clamp(1 - Math.max(0, vf) / topNow, 0, 1) * dt * (vf < 0 ? 2 : 1)
  if (input.brake > 0) { if (vf > 6) { vf -= s.brake * input.brake * dt; car.brake = true } else vf -= s.acc * 0.5 * input.brake * dt }
  vf = clamp(vf, -topNow * 0.3, topNow * 1.05)
  vf -= vf * (off ? 0.9 : 0.12) * dt + Math.sign(vf) * 14 * dt          // rolling resistance and grass drag
  if (!input.gas && !input.brake && Math.abs(vf) < 8) vf = 0
  // sideways grip: the lower it is, the more the car slides
  const grip = s.grip * (off ? 0.55 : 1) * (car.brake ? 0.8 : 1)
  vl *= Math.exp(-grip * dt)
  // steering: turns less at very high speed, cannot turn when stopped
  const speedF = clamp(Math.abs(vf) / 110, 0, 1), hi = 1 - 0.38 * clamp(Math.abs(vf) / s.top, 0, 1)
  const target = (input.steer || 0) * s.turn * speedF * hi * (vf < 0 ? -1 : 1)
  car.w += (target - car.w) * clamp(14 * dt, 0, 1)
  car.h = wrapAngle(car.h + car.w * dt)
  const nfx = Math.cos(car.h), nfy = Math.sin(car.h)
  car.vx = nfx * vf - nfy * vl; car.vy = nfy * vf + nfx * vl
  car.drift = Math.min(1, Math.abs(vl) / 60)
  car.x += car.vx * dt; car.y += car.vy * dt
  // barriers: a wall a little beyond the grass
  const n2 = nearest(track, car.x, car.y, near.i)
  if (Math.abs(n2.lat) > track.wall) {
    const side = Math.sign(n2.lat), nx = -track.ty[n2.i] * side, ny = track.tx[n2.i] * side      // outward normal
    const push = Math.abs(n2.lat) - track.wall
    car.x -= nx * push; car.y -= ny * push
    const vn = car.vx * nx + car.vy * ny
    if (vn > 0) { car.vx -= nx * vn * 1.4; car.vy -= ny * vn * 1.4; car.vx *= 0.82; car.vy *= 0.82; car.hit = Math.min(1, vn / 120) }
  }
  // other cars: soft bumping
  for (const o of others) {
    const dx = car.x - o.x, dy = car.y - o.y, d = Math.hypot(dx, dy), min = CAR_WID + 14
    if (d < min && d > 0.01) { const nx = dx / d, ny = dy / d, p = (min - d) * 0.6; car.x += nx * p; car.y += ny * p; const vn = car.vx * nx + car.vy * ny; if (vn < 0) { car.vx -= nx * vn * 0.9; car.vy -= ny * vn * 0.9 } car.hit = 0.6 }
  }
  car.hit *= Math.exp(-4 * dt)
  // lap counting: progress along the centreline, counted across the start line
  const ni = nearest(track, car.x, car.y, near.i).i
  let d = ni - car.idx
  if (d < -track.N / 2) car.lapsDone++; else if (d > track.N / 2) car.lapsDone--
  car.idx = ni
  car.total = car.lapsDone * track.N + ni                 // 0 at the start line, track.N per lap
  return car
}

// A simple driver used by the tests (and as a "ghost" check that every map can really be driven).
export function botInput(car, track, skill = 1) {
  const look = Math.round(10 + Math.abs(car.vx * car.vx + car.vy * car.vy) ** 0.5 / 10)
  const ti = (car.idx + look) % track.N
  const dx = track.x[ti] - car.x, dy = track.y[ti] - car.y
  const err = wrapAngle(Math.atan2(dy, dx) - car.h)
  // slow down for the corner ahead
  const a = Math.atan2(track.ty[ti], track.tx[ti]), b = Math.atan2(track.ty[(ti + 18) % track.N], track.tx[(ti + 18) % track.N])
  const bend = Math.abs(wrapAngle(b - a)), speed = Math.hypot(car.vx, car.vy), safe = car.spec.top * (1 - clamp(bend * 2.2, 0, 0.6)) * skill
  return { steer: clamp(err * 2.4, -1, 1), gas: speed < safe ? 1 : 0, brake: speed > safe * 1.12 ? 1 : 0 }
}
