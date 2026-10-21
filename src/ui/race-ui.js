// Car race between two people. The lobby (car, paint, map, ready) is stored in the database; the race itself is driven live:
// each phone/computer drives its own car and broadcasts where it is ~12 times a second, the other side draws it smoothly.
import { h, clear, confirmDialog } from '../lib/dom.js'
import { supabase } from '../lib/supabase.js'
import { buildTrack, newCar, stepCar, botInput, nearest, CARS, CAR_IDS, COLORS, CAR_LEN, wrapAngle } from '../games/race/engine.js'
import { TRACKS, TRACK_BY_ID, THEMES } from '../games/race/tracks.js'
import { carSprite, SPRITE_UNITS } from '../games/race/cars.js'

const trackCache = new Map()
const getTrack = (id) => { let t = trackCache.get(id); if (!t) { t = buildTrack(TRACK_BY_ID[id] || TRACKS[0]); trackCache.set(id, t) } return t }
const fmt = (ms) => { if (ms == null) return '-'; const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}` }
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)
const FAIR = CARS.coupe

/* ---------------------------------------------------------------- live channel (Supabase Realtime broadcast) */
export function openRaceChannel(name) {
  const subs = new Set()
  const ch = supabase.channel(name, { config: { broadcast: { self: false } } })
  ch.on('broadcast', { event: 'm' }, ({ payload }) => subs.forEach((f) => f(payload))).subscribe()
  return { on: (f) => subs.add(f), send: (payload) => { try { ch.send({ type: 'broadcast', event: 'm', payload }) } catch { /* ignore */ } }, close: () => supabase.removeChannel(ch) }
}

/* ---------------------------------------------------------------- small sound engine (WebAudio, no files) */
class Sound {
  constructor() { this.on = (() => { try { return localStorage.getItem('lsdk.race.sound') !== '0' } catch { return true } })(); this.ctx = null }
  unlock() { if (this.ctx || !this.on) return; try { const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C(); this.start() } catch { /* no audio */ } }
  start() {
    const c = this.ctx; if (!c) return
    this.osc = c.createOscillator(); this.osc2 = c.createOscillator(); this.gain = c.createGain(); this.lp = c.createBiquadFilter()
    this.osc.type = 'sawtooth'; this.osc2.type = 'square'; this.lp.type = 'lowpass'; this.lp.frequency.value = 700; this.gain.gain.value = 0
    this.osc.connect(this.lp); this.osc2.connect(this.lp); this.lp.connect(this.gain); this.gain.connect(c.destination); this.osc.start(); this.osc2.start()
  }
  engine(speed, gas, top) {
    if (!this.ctx || !this.gain) return
    const f = 55 + (speed / top) * 190 + gas * 14, t = this.ctx.currentTime
    this.osc.frequency.setTargetAtTime(f, t, 0.05); this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05)
    this.lp.frequency.setTargetAtTime(500 + (speed / top) * 1400, t, 0.08)
    this.gain.gain.setTargetAtTime(this.on ? 0.028 + gas * 0.02 : 0, t, 0.08)
  }
  beep(freq, ms = 140) {
    if (!this.ctx || !this.on) return
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime
    o.frequency.value = freq; o.type = 'sine'; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000)
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + ms / 1000 + 0.02)
  }
  toggle() { this.on = !this.on; try { localStorage.setItem('lsdk.race.sound', this.on ? '1' : '0') } catch { /* ignore */ } if (this.on) this.unlock(); else this.engine(0, 0, 1); return this.on }
  stop() { try { this.osc?.stop(); this.osc2?.stop(); this.ctx?.close() } catch { /* ignore */ } this.ctx = null }
}

/* ---------------------------------------------------------------- the live race */
class RaceRun {
  constructor(ctrl, o) {
    Object.assign(this, { ctrl, track: o.track, laps: o.laps, balanced: o.balanced, bot: o.bot, sound: ctrl.sound })
    this.theme = THEMES[this.track.theme] || THEMES.forest
    this.me = newCar(this.track, o.place, o.car.id); this.me.spec = this.balanced ? FAIR : CARS[o.car.id] || FAIR
    this.opp = { ...newCar(this.track, 1 - o.place, o.opp.id), tx: 0, ty: 0, vx: 0, vy: 0, seen: 0, total: 0, fin: null }
    this.opp.tx = this.opp.x; this.opp.ty = this.opp.y; this.opp.th = this.opp.h
    this.myLook = o.car; this.oppLook = o.opp; this.oppName = o.oppName
    this.phase = 'countdown'; this.cdStart = performance.now(); this.t0 = 0; this.lastBeep = 4
    this.keys = { left: false, right: false, gas: false, brake: false }; this.steer = 0; this.autoGas = false
    this.skids = []; this.parts = []; this.zoom = 1; this.cam = { x: this.me.x, y: this.me.y }; this.shake = 0
    this.sendAt = 0; this.finished = false; this.over = false; this.acc = 0; this.last = performance.now()
    this.build(); this.scenery = this.makeScenery(); this.path = this.makePath(); this.pattern = this.makePattern()
    this.bindInput(); this.raf = requestAnimationFrame((t) => this.loop(t))
    this.measure()
  }

  /* --- DOM --- */
  build() {
    this.cv = h('canvas', { class: 'race-cv', 'aria-label': 'Race track' })
    this.mini = h('canvas', { class: 'race-mini', width: 160, height: 110, 'aria-hidden': 'true' })
    this.hLap = h('b', {}, '1/' + this.laps); this.hPos = h('b', {}, '1st'); this.hTime = h('b', {}, '0:00.00'); this.hSpeed = h('b', {}, '0')
    this.cd = h('div', { class: 'race-cd', 'aria-live': 'assertive' })
    this.note = h('div', { class: 'race-note', hidden: true })
    this.over$ = h('div', { class: 'race-over', hidden: true })
    const hold = (key, label, cls) => {
      const b = h('button', { class: `rt ${cls}`, type: 'button', 'aria-label': label }, label)
      const set = (v) => (e) => { e.preventDefault(); this.keys[key] = v; b.classList.toggle('on', v) }
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture?.(e.pointerId); set(true)(e); this.sound.unlock() })
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, set(false))
      b.addEventListener('contextmenu', (e) => e.preventDefault())
      return b
    }
    this.auto = h('button', { class: 'rt auto', type: 'button', 'aria-pressed': 'false', onclick: () => { this.autoGas = !this.autoGas; this.auto.classList.toggle('on', this.autoGas); this.auto.setAttribute('aria-pressed', String(this.autoGas)) } }, 'AUTO')
    this.touch = h('div', { class: 'race-touch' }, h('div', { class: 'rt-left' }, hold('left', '◀', 'steer'), hold('right', '▶', 'steer')), h('div', { class: 'rt-right' }, this.auto, hold('brake', 'BRAKE', 'brake'), hold('gas', 'GAS', 'gas')))
    this.snd = h('button', { class: 'race-btn', type: 'button', 'aria-label': 'Sound', onclick: () => { this.snd.textContent = this.sound.toggle() ? '🔊' : '🔇' } }, this.sound.on ? '🔊' : '🔇')
    this.leave = h('button', { class: 'race-btn leave', type: 'button', onclick: () => this.ctrl.leaveRace() }, '✕ Leave')
    this.el = h('div', { class: 'race-stage', role: 'application', 'aria-label': 'Car race' }, this.cv,
      h('div', { class: 'race-hud top' }, this.leave, h('div', { class: 'race-chip' }, 'LAP ', this.hLap), h('div', { class: 'race-chip' }, this.hTime), this.snd, this.mini),
      h('div', { class: 'race-hud bottom' }, h('div', { class: 'race-chip big' }, this.hPos), h('div', { class: 'race-chip big speed' }, this.hSpeed, h('small', {}, ' km/h'))),
      this.cd, this.note, this.touch, this.over$)
    this.ctrl.el.append(this.el)
    this.ctx = this.cv.getContext('2d')
    this.ro = new ResizeObserver(() => this.measure()); this.ro.observe(this.el)
  }
  measure() {
    const r = this.el.getBoundingClientRect(), dpr = Math.min(2.5, window.devicePixelRatio || 1)
    this.w = Math.max(200, r.width); this.hh = Math.max(200, r.height); this.dpr = dpr
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.hh * dpr)
  }
  bindInput() {
    const map = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake', ' ': 'brake' }
    this.kd = (e) => { const k = map[e.key]; if (k) { e.preventDefault(); this.keys[k] = true; this.sound.unlock() } }
    this.ku = (e) => { const k = map[e.key]; if (k) { e.preventDefault(); this.keys[k] = false } }
    window.addEventListener('keydown', this.kd); window.addEventListener('keyup', this.ku)
  }

  /* --- world dressing --- */
  makePath() {
    const t = this.track, p = new Path2D()
    for (let i = 0; i < t.N; i += 2) (i ? p.lineTo(t.x[i], t.y[i]) : p.moveTo(t.x[i], t.y[i]))
    p.closePath(); return p
  }
  makePattern() {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const x = c.getContext('2d'), r = rng(hash(this.track.id)); x.fillStyle = this.theme.ground; x.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 900; i++) { x.fillStyle = r() < 0.5 ? this.theme.ground2 : 'rgba(255,255,255,.05)'; const s = 2 + r() * 7; x.fillRect(r() * 256, r() * 256, s, s * (0.5 + r())) }
    return this.ctx.createPattern(c, 'repeat')
  }
  makeScenery() {
    const t = this.track, r = rng(hash(t.id) + 11), items = [], kind = this.theme.scenery
    for (let i = 0; i < t.N; i += kind === 'buildings' ? 5 : 8) for (const side of [-1, 1]) {
      if (r() > (kind === 'buildings' ? 0.9 : 0.75)) continue
      const off = t.wall + 50 + r() * (kind === 'buildings' ? 160 : 420), nx = -t.ty[i] * side, ny = t.tx[i] * side
      const x = t.x[i] + nx * off, y = t.y[i] + ny * off
      if (nearest(t, x, y, -1).dist < t.wall + 40) continue
      items.push({ x, y, s: 24 + r() * 34, a: Math.atan2(t.ty[i], t.tx[i]), v: r(), k: kind })
    }
    // grandstands along the start straight
    for (const side of [-1, 1]) { const i = 0, off = t.wall + 38, nx = -t.ty[i] * side, ny = t.tx[i] * side; items.push({ x: t.x[i] + nx * off, y: t.y[i] + ny * off, s: 110, a: Math.atan2(t.ty[i], t.tx[i]), v: 0.5, k: 'stand' }) }
    return items
  }

  /* --- net --- */
  onMsg(m) {
    if (m.k === 'p') { const o = this.opp; o.tx = m.x; o.ty = m.y; o.th = m.h; o.vx = m.vx; o.vy = m.vy; o.total = m.tot; o.seen = performance.now(); o.speed = Math.hypot(m.vx, m.vy); o.brake = m.b; if (!o.init) { o.x = m.x; o.y = m.y; o.h = m.h; o.init = true } }
    else if (m.k === 'f') { this.opp.fin = m.ms; this.ctrl.oppFinished(m.ms) }
  }

  /* --- main loop --- */
  loop(now) {
    if (this.over) return
    this.raf = requestAnimationFrame((t) => this.loop(t))
    let dt = Math.min(0.1, (now - this.last) / 1000); this.last = now
    this.update(dt, now); this.draw(now)
  }
  inputNow(dt) {
    if (this.bot) return botInput(this.me, this.track, 0.96)
    const k = this.keys, target = (k.right ? 1 : 0) - (k.left ? 1 : 0)
    this.steer += (target - this.steer) * Math.min(1, dt * 9)
    return { steer: this.steer, gas: k.gas || (this.autoGas && !k.brake) ? 1 : 0, brake: k.brake ? 1 : 0 }
  }
  update(dt, now) {
    const t = this.track, me = this.me, o = this.opp
    if (this.phase === 'countdown') {
      const left = 3.8 - (now - this.cdStart) / 1000, n = Math.ceil(left - 0.8)
      if (left > 0.8) { const c = Math.max(1, n); if (c !== this.lastBeep) { this.lastBeep = c; this.sound.beep(440) } this.cd.textContent = String(c); this.cd.classList.remove('go') }
      else { this.phase = 'racing'; this.t0 = now; this.cd.textContent = 'GO!'; this.cd.classList.add('go'); this.sound.beep(880, 380); setTimeout(() => { if (this.cd) this.cd.textContent = '' }, 900) }
    }
    const racing = this.phase === 'racing', ms = racing ? now - this.t0 : 0
    // opponent ghost: glide toward the last known position, predicted forward by its speed
    if (o.init) {
      const age = Math.min(0.3, (now - o.seen) / 1000), k = 1 - Math.exp(-12 * dt)
      o.x += (o.tx + o.vx * age - o.x) * k; o.y += (o.ty + o.vy * age - o.y) * k; o.h = wrapAngle(o.h + wrapAngle(o.th - o.h) * k)
      if (now - o.seen > 8000 && racing) this.say('Waiting for ' + this.oppName + '… connection lost?'); else if (this.noteOn === 'lost') this.say(null)
    }
    // my car: fixed small steps so the driving feels the same on every device
    const step = 1 / 120; this.acc += dt
    while (this.acc >= step) {
      this.acc -= step
      if (!racing || this.finished) { if (this.finished) stepCar(me, { gas: 0, brake: 1, steer: 0 }, t, step, []); continue }
      stepCar(me, this.inputNow(step), t, step, o.init ? [o] : [])
    }
    this.skidNow = false
    if (me.onGrass || me.drift > 0.3 || me.brake) this.addSkid(me, racing)
    if (me.hit > 0.55 && !this.hitLatch) { this.hitLatch = true; this.shake = 6; navigator.vibrate?.(25) } else if (me.hit < 0.2) this.hitLatch = false
    this.shake *= Math.exp(-9 * dt)
    // finish line
    if (racing && !this.finished && me.total >= this.laps * t.N) { this.finished = true; me.finishMs = ms; this.ctrl.iFinished(ms); this.say('Finished! ' + fmt(ms)) }
    // sound
    const sp = Math.hypot(me.vx, me.vy); this.sound.engine(this.phase === 'racing' && !this.finished ? sp : 0, this.keys.gas || this.autoGas ? 1 : 0, me.spec.top)
    // network
    if (now - this.sendAt > 80) { this.sendAt = now; this.ctrl.net.send({ k: 'p', x: +me.x.toFixed(1), y: +me.y.toFixed(1), h: +me.h.toFixed(3), vx: +me.vx.toFixed(1), vy: +me.vy.toFixed(1), tot: me.total, b: me.brake ? 1 : 0 }) }
    // particles
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.r += dt * 14 }
    this.parts = this.parts.filter((p) => p.life > 0)
    if (this.skidNow && sp > 40) this.puff(me, me.onGrass ? this.theme.run : '#d8d8d8')
    // HUD text
    const lap = Math.min(this.laps, Math.max(1, Math.floor(me.total / t.N) + 1))
    this.setText(this.hLap, `${lap}/${this.laps}`); this.setText(this.hTime, fmt(this.finished ? me.finishMs : ms)); this.setText(this.hSpeed, String(Math.round(sp * 0.9)))
    const ahead = this.finished ? me.finishMs <= (o.fin ?? 1e12) : o.fin != null ? false : me.total >= o.total
    this.setText(this.hPos, ahead ? '1st' : '2nd')
    this.cam.x += (me.x + me.vx * 0.3 - this.cam.x) * (1 - Math.exp(-6 * dt)); this.cam.y += (me.y + me.vy * 0.3 - this.cam.y) * (1 - Math.exp(-6 * dt))
    const targetZoom = 1 - 0.2 * Math.min(1, sp / me.spec.top); this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-2 * dt))
  }
  setText(el, v) { if (el.textContent !== v) el.textContent = v }
  say(text) { this.noteOn = text ? (text.startsWith('Waiting') ? 'lost' : 'msg') : null; this.note.hidden = !text; if (text) this.note.textContent = text }
  addSkid(c, racing) {
    if (!racing) return
    this.skidNow = true
    const fx = Math.cos(c.h), fy = Math.sin(c.h)
    if (c.drift > 0.3 || c.brake) for (const s of [-1, 1]) { this.skids.push({ x: c.x - fx * 13 - fy * s * 9, y: c.y - fy * 13 + fx * s * 9, a: Math.min(0.5, 0.18 + c.drift * 0.4) }) }
    if (this.skids.length > 700) this.skids.splice(0, this.skids.length - 700)
  }
  puff(c, color) { if (this.parts.length > 90 || Math.random() > 0.5) return; this.parts.push({ x: c.x - Math.cos(c.h) * 18, y: c.y - Math.sin(c.h) * 18, vx: -c.vx * 0.1 + (Math.random() - 0.5) * 30, vy: -c.vy * 0.1 + (Math.random() - 0.5) * 30, life: 0.5, r: 3, c: color }) }

  /* --- drawing --- */
  draw(now) {
    const ctx = this.ctx, t = this.track, th = this.theme, dpr = this.dpr
    const k = Math.min(this.w, this.hh) / 560 * this.zoom * dpr
    const sx = this.shake * (Math.random() - 0.5), sy = this.shake * (Math.random() - 0.5)
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = th.ground; ctx.fillRect(0, 0, this.cv.width, this.cv.height)
    ctx.setTransform(k, 0, 0, k, this.cv.width / 2 - this.cam.x * k + sx, this.cv.height / 2 - this.cam.y * k + sy)
    const vw = this.cv.width / k, vh = this.cv.height / k, x0 = this.cam.x - vw / 2, y0 = this.cam.y - vh / 2
    ctx.fillStyle = this.pattern; ctx.fillRect(x0 - 8, y0 - 8, vw + 16, vh + 16)
    const near = (x, y, r) => x > x0 - r && x < x0 + vw + r && y > y0 - r && y < y0 + vh + r
    for (const s of this.scenery) if (near(s.x, s.y, 220)) this.drawScenery(ctx, s)
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt'
    const W = t.width
    ctx.strokeStyle = '#d94141'; ctx.lineWidth = W + 150; ctx.stroke(this.path)                                       // barrier (red/white)
    ctx.strokeStyle = '#f4f4f4'; ctx.setLineDash([22, 22]); ctx.stroke(this.path); ctx.setLineDash([])
    ctx.strokeStyle = th.run; ctx.lineWidth = W + 132; ctx.stroke(this.path)                                         // run-off area
    ctx.strokeStyle = '#d94141'; ctx.lineWidth = W + 18; ctx.stroke(this.path)                                       // kerbs
    ctx.strokeStyle = '#f4f4f4'; ctx.setLineDash([20, 20]); ctx.stroke(this.path); ctx.setLineDash([])
    ctx.strokeStyle = '#4b4e57'; ctx.lineWidth = W; ctx.stroke(this.path)                                           // asphalt
    ctx.strokeStyle = 'rgba(30,30,36,.22)'; ctx.lineWidth = W * 0.42; ctx.stroke(this.path)                           // worn racing line
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3; ctx.setLineDash([26, 34]); ctx.stroke(this.path); ctx.setLineDash([])
    this.drawStartLine(ctx)
    ctx.fillStyle = 'rgba(15,15,18,.5)'; for (const s of this.skids) if (near(s.x, s.y, 10)) { ctx.globalAlpha = s.a; ctx.beginPath(); ctx.arc(s.x, s.y, 2.4, 0, 7); ctx.fill() } ctx.globalAlpha = 1
    // cars: the one behind first
    const cars = [{ c: this.opp, look: this.oppLook, name: this.oppName, show: this.opp.init }, { c: this.me, look: this.myLook, me: true, show: true }]
    for (const e of cars) if (e.show) this.drawCar(ctx, e)
    for (const p of this.parts) { ctx.globalAlpha = Math.max(0, p.life) * 0.9; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill() } ctx.globalAlpha = 1
    this.drawMini()
  }
  drawStartLine(ctx) {
    const t = this.track, i = 0, tx = t.tx[i], ty = t.ty[i], nx = -ty, ny = tx, cols = 12, cw = t.width / cols
    ctx.save(); ctx.translate(t.x[i], t.y[i]); ctx.rotate(Math.atan2(ty, tx))
    for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) { ctx.fillStyle = (r + c) % 2 ? '#111' : '#f5f5f5'; ctx.fillRect(r * 9 - 9, -t.width / 2 + c * cw, 9, cw + 0.5) }
    ctx.restore(); void nx; void ny
  }
  drawScenery(ctx, s) {
    ctx.save(); ctx.translate(s.x, s.y)
    if (s.k === 'trees' || s.k === 'palms') {
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.arc(5, 6, s.s * 0.62, 0, 7); ctx.fill()
      const g = ctx.createRadialGradient(-s.s * 0.15, -s.s * 0.2, 2, 0, 0, s.s * 0.62); g.addColorStop(0, s.v > 0.5 ? '#5fae52' : '#4a9a45'); g.addColorStop(1, s.v > 0.5 ? '#1f5a2b' : '#1b4d27')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s.s * 0.6, 0, 7); ctx.fill()
      if (s.k === 'palms') { ctx.strokeStyle = '#2f7a3a'; ctx.lineWidth = 3; for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s.s * 0.8, Math.sin(a) * s.s * 0.8); ctx.stroke() } }
    } else if (s.k === 'bush') {
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(4, 5, s.s * 0.5, s.s * 0.36, 0, 0, 7); ctx.fill(); ctx.fillStyle = s.v > 0.5 ? '#8c9a4a' : '#9b8b45'; ctx.beginPath(); ctx.ellipse(0, 0, s.s * 0.46, s.s * 0.34, s.a, 0, 7); ctx.fill()
    } else if (s.k === 'buildings') {
      ctx.rotate(s.a); const w = s.s * 2.2, hh = s.s * 1.5
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(-w / 2 + 8, -hh / 2 + 8, w, hh)
      ctx.fillStyle = ['#c9b79c', '#b7c4cf', '#d8c3a5', '#a9b4a0'][Math.floor(s.v * 4) % 4]; ctx.fillRect(-w / 2, -hh / 2, w, hh)
      ctx.fillStyle = '#8a8f96'; ctx.fillRect(-w / 2 + 6, -hh / 2 + 6, w - 12, hh - 12); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-w / 2 + 6, -hh / 2 + 6, w - 12, 8)
    } else if (s.k === 'stand') {
      ctx.rotate(s.a); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-s.s * 2 + 6, -26 + 6, s.s * 4, 52); ctx.fillStyle = '#7d7f88'; ctx.fillRect(-s.s * 2, -26, s.s * 4, 52)
      for (let i = 0; i < 80; i++) { ctx.fillStyle = ['#e63946', '#f4a300', '#1e90ff', '#f2f2f2', '#2ec27e'][(i * 7) % 5]; ctx.fillRect(-s.s * 2 + 6 + (i % 40) * (s.s * 4 - 12) / 40, -20 + Math.floor(i / 40) * 22, 4, 4) }
    } else if (s.k === 'grandstand') {
      ctx.rotate(s.a); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-s.s + 5, -14 + 5, s.s * 2, 28); ctx.fillStyle = s.v > 0.5 ? '#a8adb5' : '#b9bdc4'; ctx.fillRect(-s.s, -14, s.s * 2, 28)
    }
    ctx.restore()
  }
  drawCar(ctx, e) {
    const c = e.c, sp = carSprite(e.look.id, e.look.color, 4), uw = SPRITE_UNITS.w, uh = SPRITE_UNITS.h
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.h)
    ctx.drawImage(sp, -uw / 2, -uh / 2, uw, uh)
    if (c.brake) { ctx.fillStyle = 'rgba(255,40,40,.95)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(-CAR_LEN / 2 - 1, s * 8, 3.4, 0, 7); ctx.fill() } }
    ctx.restore()
    if (!e.me && e.name) { ctx.save(); ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(e.name, c.x, c.y - 34); ctx.fillStyle = '#fff'; ctx.fillText(e.name, c.x, c.y - 34); ctx.restore() }
  }
  drawMini() {
    const m = this.mini, x = m.getContext('2d'), t = this.track, b = t.bbox, w = m.width, hh = m.height, pad = 8
    const s = Math.min((w - pad * 2) / (b.maxX - b.minX), (hh - pad * 2) / (b.maxY - b.minY)), ox = (w - (b.maxX - b.minX) * s) / 2, oy = (hh - (b.maxY - b.minY) * s) / 2
    const X = (v) => ox + (v - b.minX) * s, Y = (v) => oy + (v - b.minY) * s
    if (!this.miniBase) {
      const c = document.createElement('canvas'); c.width = w; c.height = hh; const cx = c.getContext('2d'); cx.lineJoin = 'round'
      cx.beginPath(); for (let i = 0; i < t.N; i += 3) (i ? cx.lineTo(X(t.x[i]), Y(t.y[i])) : cx.moveTo(X(t.x[i]), Y(t.y[i]))); cx.closePath()
      cx.strokeStyle = 'rgba(0,0,0,.55)'; cx.lineWidth = 6; cx.stroke(); cx.strokeStyle = '#e9e9f2'; cx.lineWidth = 3; cx.stroke(); this.miniBase = c
    }
    x.clearRect(0, 0, w, hh); x.drawImage(this.miniBase, 0, 0)
    for (const [c, col] of [[this.opp, this.oppLook.color], [this.me, this.myLook.color]]) { if (c === this.opp && !c.init) continue; x.fillStyle = col; x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(X(c.x), Y(c.y), 5, 0, 7); x.fill(); x.stroke() }
  }

  /* --- ending --- */
  showResult({ title, sub, lines }) {
    this.say(null); clear(this.over$).append(h('div', { class: 'race-card' }, h('h2', {}, title), sub ? h('p', {}, sub) : null, h('div', { class: 'race-times' }, lines.map(([n, v]) => h('div', {}, h('span', {}, n), h('b', {}, v)))), h('button', { class: 'btn primary', type: 'button', onclick: () => this.ctrl.closeRun() }, 'Continue')))
    this.over$.hidden = false; this.cd.textContent = ''
  }
  destroy() {
    this.over = true; cancelAnimationFrame(this.raf); this.ro?.disconnect()
    window.removeEventListener('keydown', this.kd); window.removeEventListener('keyup', this.ku)
    this.sound.engine(0, 0, 1); this.el.remove()
  }
}

/* ---------------------------------------------------------------- lobby + glue */
const bar = (v) => h('span', { class: 'rbar' }, h('i', { dataset: { v: String(Math.round(Math.max(0.05, Math.min(1, v)) * 20) * 5) } }))
const stat = (spec) => ({ Speed: (spec.top - 240) / 120, Accel: (spec.acc - 140) / 100, Handling: (spec.turn - 1.9) / 1.1, Grip: (spec.grip - 4.5) / 5, 'Off-road': (spec.off - 0.3) / 0.55 })

const thumbCache = new Map()
function thumb(id) {
  if (thumbCache.has(id)) { const c = h('canvas', { class: 'map-thumb', width: 220, height: 130, 'aria-hidden': 'true' }); c.getContext('2d').drawImage(thumbCache.get(id), 0, 0); return c }
  const t = getTrack(id), c = h('canvas', { class: 'map-thumb', width: 220, height: 130, 'aria-hidden': 'true' }), x = c.getContext('2d'), b = t.bbox, pad = 14
  const s = Math.min((220 - pad * 2) / (b.maxX - b.minX), (130 - pad * 2) / (b.maxY - b.minY)), ox = (220 - (b.maxX - b.minX) * s) / 2, oy = (130 - (b.maxY - b.minY) * s) / 2
  x.lineJoin = 'round'; x.beginPath(); for (let i = 0; i < t.N; i += 3) { const px = ox + (t.x[i] - b.minX) * s, py = oy + (t.y[i] - b.minY) * s; i ? x.lineTo(px, py) : x.moveTo(px, py) } x.closePath()
  x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 9; x.stroke(); x.strokeStyle = '#eef0f7'; x.lineWidth = 5; x.stroke()
  x.fillStyle = '#e63946'; x.beginPath(); x.arc(ox + (t.x[0] - b.minX) * s, oy + (t.y[0] - b.minY) * s, 5, 0, 7); x.fill()
  thumbCache.set(id, c)
  return thumb(id)
}
const spritePreview = (id, color, cls = 'car-prev') => { const sp = carSprite(id, color, 4), c = h('canvas', { class: cls, width: sp.width, height: sp.height, 'aria-hidden': 'true' }); c.getContext('2d').drawImage(sp, 0, 0); return c }

export class RaceController {
  // deps: { game, me, nameOf, api: { setup(o), finish(winner, times) }, net(name) -> channel, bot? }
  constructor(deps) {
    Object.assign(this, deps)
    this.sound = new Sound(); this.el = h('div', { class: 'race' }); this.run = null; this.round = null; this.ready = false
    this.net = this.net(`race-${this.game.id}`); this.net.on((m) => this.run?.onMsg(m))
    this.sentDefault = false
  }
  get host() { return this.game.p1 === this.me }
  get oppId() { return this.host ? this.game.p2 : this.game.p1 }
  get st() { return this.game.state || {} }
  mine() { const c = this.st.cars?.[this.me] || {}; return { id: CARS[c.car] ? c.car : 'coupe', color: c.color || COLORS[0] } }
  theirs() { const c = this.st.cars?.[this.oppId] || {}; return { id: CARS[c.car] ? c.car : 'coupe', color: c.color || COLORS[4], picked: !!c.car } }
  statusText() { return this.run ? (this.run.phase === 'countdown' ? 'Get ready…' : 'Racing!') : this.game.status === 'done' ? '' : 'Race lobby' }

  sync(game) {
    const prev = this.game; this.game = game
    const round = this.st.round ?? 0
    if (this.round == null) this.round = round
    if (game.status === 'active' && round > this.round) { this.round = round; this.startRun() }
    if (game.status === 'done' && this.run && this.run.over$.hidden) this.finishRun()
    if (!this.run) this.renderLobby()
    if (!this.sentDefault && game.status === 'active' && !this.st.cars?.[this.me]) { this.sentDefault = true; this.api.setup({ car: 'coupe', color: COLORS[this.host ? 0 : 4] }).catch(() => {}) }
    // when both are ready the host starts the race (the database then tells both sides at the same moment)
    const r = this.st.ready || {}
    if (!this.run && game.status === 'active' && this.host && r[this.me] && r[this.oppId] && !this.starting) { this.starting = true; this.api.setup({ start: true }).catch(() => {}).finally(() => { this.starting = false }) }
    void prev
  }

  startRun() {
    const st = this.st, track = getTrack(st.map), me = this.mine(), opp = this.theirs()
    this.run?.destroy(); this.sound.unlock(); this.oppFin = null; this.myFin = null
    this.run = new RaceRun(this, { track, laps: st.laps || 3, balanced: !!st.balanced, car: me, opp, oppName: this.nameOf(this.oppId), place: this.host ? 0 : 1, bot: this.bot })
    clear(this.el); this.el.append(this.run.el)
  }
  iFinished(ms) {
    this.myFin = ms; this.net.send({ k: 'f', ms })
    const times = { [this.me]: ms }; if (this.oppFin != null) times[this.oppId] = this.oppFin
    if (this.oppFin == null) this.api.finish(this.me, times).catch(() => {})                       // I crossed first
    else setTimeout(() => { if (this.game.status === 'active') this.api.finish(this.oppId, times).catch(() => {}) }, 5000)   // they crossed first: they report it; this is the backup
  }
  oppFinished(ms) { this.oppFin = ms; if (this.run && !this.run.finished) this.run.say(`${this.nameOf(this.oppId)} finished! Keep going…`) }
  finishRun() {
    const g = this.game, t = g.state?.times || {}, won = g.winner === this.me
    this.run?.showResult({ title: won ? 'You won! 🏆' : g.winner ? `${this.nameOf(g.winner)} won` : 'Race over', sub: g.result === 'Gave up' ? 'The race ended early.' : '',
      lines: [['You', fmt(t[this.me] ?? this.myFin)], [this.nameOf(this.oppId), fmt(t[this.oppId] ?? this.oppFin)]] })
  }
  async leaveRace() {
    if (!(await confirmDialog('Leave the race?', 'Leaving counts as giving up, and your friend wins.', 'Leave', true))) return
    this.run?.destroy(); this.run = null; this.renderLobby(); this.onLeave?.()
  }
  closeRun() { this.run?.destroy(); this.run = null; this.renderLobby() }
  destroy() { this.run?.destroy(); this.run = null; this.sound.stop(); try { this.net.close() } catch { /* ignore */ } }

  /* --- lobby --- */
  renderLobby() {
    const g = this.game, st = this.st, me = this.mine(), opp = this.theirs(), done = g.status === 'done', ready = st.ready || {}
    const set = (o) => this.api.setup(o).catch((e) => this.onError?.(e))
    const spec = CARS[me.id], fair = !!st.balanced
    const driver = (who, look, name, isReady, picked) => h('div', { class: 'drv' }, spritePreview(look.id, look.color, 'drv-car'), h('b', {}, name), h('small', {}, picked ? CARS[look.id].name : 'choosing…'), h('span', { class: `rdy${isReady ? ' on' : ''}` }, isReady ? 'Ready' : 'Not ready'))
    const carBtns = CAR_IDS.map((id) => h('button', { class: `car-opt${me.id === id ? ' on' : ''}`, type: 'button', 'aria-pressed': String(me.id === id), disabled: done, onclick: () => set({ car: id }) }, spritePreview(id, me.color, 'car-thumb'), h('span', {}, CARS[id].name)))
    const swatches = COLORS.map((c) => h('button', { class: `sw${me.color === c ? ' on' : ''}`, type: 'button', 'aria-label': `Paint ${c}`, disabled: done, dataset: { c }, onclick: () => set({ color: c }) }))
    swatches.forEach((b) => { b.style.background = b.dataset.c })
    const stats = Object.entries(stat(fair ? FAIR : spec)).map(([n, v]) => h('div', { class: 'rstat' }, h('span', {}, n), bar(v)))
    const mapCards = TRACKS.map((t) => h('button', { class: `map-opt${st.map === t.id ? ' on' : ''}`, type: 'button', 'aria-pressed': String(st.map === t.id), disabled: done || !this.host, onclick: () => set({ map: t.id }) }, thumb(t.id), h('b', {}, t.name), h('small', {}, `${t.country} · ${t.km} km`)))
    const lapsSel = h('select', { 'aria-label': 'Laps', disabled: done || !this.host, onchange: (e) => set({ laps: +e.target.value }) }, [1, 2, 3, 5].map((n) => h('option', { value: n, selected: (st.laps || 3) === n }, `${n} lap${n > 1 ? 's' : ''}`)))
    const fairCb = h('input', { type: 'checkbox', id: 'race-fair', role: 'switch', disabled: done || !this.host, checked: fair, onchange: (e) => set({ balanced: e.target.checked }) })
    const myReady = !!ready[this.me]
    const body = h('div', { class: 'race-lobby' },
      done ? h('div', { class: 'race-done' }, h('h3', {}, g.winner === this.me ? 'You won the race! 🏆' : g.winner ? `${this.nameOf(g.winner)} won the race` : 'Race over'),
        g.state?.times ? h('div', { class: 'race-times' }, [[ 'You', g.state.times[this.me] ], [this.nameOf(this.oppId), g.state.times[this.oppId]]].map(([n, v]) => h('div', {}, h('span', {}, n), h('b', {}, fmt(v))))) : null) : null,
      h('div', { class: 'drivers' }, driver('me', me, 'You', myReady, true), h('span', { class: 'vs' }, 'VS'), driver('opp', opp, this.nameOf(this.oppId), !!ready[this.oppId], opp.picked)),
      h('h3', {}, 'Your car'), h('div', { class: 'car-grid' }, carBtns),
      h('div', { class: 'car-info' }, spritePreview(me.id, me.color, 'car-big'), h('div', {}, h('b', {}, spec.name), h('small', {}, ` ${spec.kind}`), h('p', { class: 'small' }, spec.blurb), h('div', { class: 'rstats' }, stats))),
      h('div', { class: 'swatches', role: 'group', 'aria-label': 'Paint colour' }, swatches),
      h('h3', {}, this.host ? 'Pick the circuit' : `Circuit (${this.nameOf(this.oppId)} picks)`), h('div', { class: 'map-grid' }, mapCards),
      h('div', { class: 'race-opts' }, h('label', {}, 'Laps ', lapsSel), h('label', { class: 'fair', for: 'race-fair' }, fairCb, ' Fair race (every car performs the same)')),
      h('p', { class: 'small' }, 'Layouts are simplified drawings of the real circuits. Steer with the arrow keys / A D, gas W, brake S or space. On a phone use the on-screen buttons.'),
      done ? null : h('button', { class: `btn primary race-go${myReady ? ' on' : ''}`, type: 'button', onclick: () => { this.sound.unlock(); set({ ready: !myReady }) } }, myReady ? (ready[this.oppId] ? 'Starting…' : `Waiting for ${this.nameOf(this.oppId)}… (tap to cancel)`) : "I'm ready"))
    clear(this.el).append(body)
  }
}
