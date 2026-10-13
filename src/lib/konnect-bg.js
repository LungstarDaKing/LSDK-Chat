// "Konnected" background for the sign-in hero: little glowing people-dots drift around, link up when they
// get close, and send message pulses along the links. Move the mouse/finger over the hero to join the network.
// Canvas only (no inline styles), so it is allowed by the app's Content-Security-Policy.
const COLORS = ['#f5b83d', '#a996ff', '#2dd4bf', '#ff7a8c', '#6fa0ff']

export function startKonnect(canvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const host = canvas.parentElement?.parentElement || canvas.parentElement   // the hero
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  let w = 0, h = 0, link = 120, nodes = [], pulses = [], ripples = [], raf = 0, last = 0, nextPulse = 0
  const me = { x: 0, y: 0, on: false }

  function resize() {
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = r.width; h = r.height
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    link = Math.min(150, Math.max(80, w / 6))
    const want = Math.round(Math.min(48, Math.max(14, (w * h) / 16000)))
    while (nodes.length < want) nodes.push(spawn())
    nodes.length = want
    if (calm) draw()
  }
  const spawn = () => {
    const a = Math.random() * Math.PI * 2, s = 8 + Math.random() * 16           // pixels per second
    return { x: Math.random() * (w || 400), y: Math.random() * (h || 600), vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 1.6 + Math.random() * 2.2, c: COLORS[(Math.random() * COLORS.length) | 0], ph: Math.random() * 6.28 }
  }

  function step(dt) {
    for (const n of nodes) {
      n.x += n.vx * dt; n.y += n.vy * dt
      if (n.x < -10) n.x = w + 10; else if (n.x > w + 10) n.x = -10
      if (n.y < -10) n.y = h + 10; else if (n.y > h + 10) n.y = -10
    }
    // a new message pulse every so often, along a random link
    nextPulse -= dt
    if (nextPulse <= 0) {
      nextPulse = 0.35 + Math.random() * 0.5
      const a = nodes[(Math.random() * nodes.length) | 0]
      const near = nodes.filter((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < link)
      if (a && near.length && pulses.length < 14) pulses.push({ a, b: near[(Math.random() * near.length) | 0], t: 0 })
    }
    for (const p of pulses) p.t += dt / 0.9
    pulses = pulses.filter((p) => {
      if (p.t < 1) return true
      ripples.push({ x: p.b.x, y: p.b.y, t: 0, c: p.b.c }); return false
    })
    for (const r of ripples) r.t += dt / 0.8
    ripples = ripples.filter((r) => r.t < 1)
  }

  function draw(now = 0) {
    ctx.clearRect(0, 0, w, h)
    ctx.lineWidth = 1
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d < link) { ctx.strokeStyle = `rgba(190,170,255,${(1 - d / link) * 0.32})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
      }
      if (me.on) {
        const d = Math.hypot(a.x - me.x, a.y - me.y)
        if (d < link * 1.4) { ctx.strokeStyle = `rgba(245,184,61,${(1 - d / (link * 1.4)) * 0.7})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(me.x, me.y); ctx.stroke() }
      }
    }
    for (const r of ripples) { ctx.strokeStyle = r.c; ctx.globalAlpha = (1 - r.t) * 0.7; ctx.beginPath(); ctx.arc(r.x, r.y, 4 + r.t * 26, 0, 6.283); ctx.stroke() }
    ctx.globalAlpha = 1
    for (const p of pulses) {
      const x = p.a.x + (p.b.x - p.a.x) * p.t, y = p.a.y + (p.b.y - p.a.y) * p.t
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9)
      g.addColorStop(0, 'rgba(255,236,170,.95)'); g.addColorStop(1, 'rgba(245,184,61,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.fill()
    }
    for (const n of nodes) {
      const tw = 0.65 + 0.35 * Math.sin(now / 700 + n.ph)
      ctx.globalAlpha = 0.22 * tw; ctx.fillStyle = n.c; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 3.2, 0, 6.283); ctx.fill()
      ctx.globalAlpha = 0.5 + 0.5 * tw; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fill()
    }
    ctx.globalAlpha = 1
    if (me.on) { ctx.fillStyle = '#f5b83d'; ctx.beginPath(); ctx.arc(me.x, me.y, 4.5, 0, 6.283); ctx.fill() }
  }

  function frame(t) {
    if (!canvas.isConnected) return stop()                // the page was replaced: stop quietly
    const dt = Math.min((t - (last || t)) / 1000, 0.05); last = t
    step(dt); draw(t)
    raf = requestAnimationFrame(frame)
  }
  function move(e) {
    const r = canvas.getBoundingClientRect()
    me.x = e.clientX - r.left; me.y = e.clientY - r.top; me.on = true
  }
  const leave = () => { me.on = false }
  function stop() {
    cancelAnimationFrame(raf); ro.disconnect()
    host?.removeEventListener('pointermove', move); host?.removeEventListener('pointerleave', leave)
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()
  if (!calm) {
    host?.addEventListener('pointermove', move, { passive: true })
    host?.addEventListener('pointerleave', leave)
    raf = requestAnimationFrame(frame)
  }
}
