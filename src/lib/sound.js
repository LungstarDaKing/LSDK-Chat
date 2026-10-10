// Message sound + tab-title badge. No audio file is needed: the "ding" is generated in the
// browser with the Web Audio API, so nothing extra is downloaded or stored.
// The on/off choice is kept only in this browser (localStorage).
const KEY = 'lsdkchat.sound'
let ctx = null
let unlocked = false

const read = () => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
const write = (on) => { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private mode: ignore */ } }
let enabled = read()

export const soundEnabled = () => enabled
export function setSoundEnabled(on) { enabled = !!on; write(enabled); if (enabled) ding() }

// Browsers only allow sound after the person has clicked or pressed a key once on the page.
function unlock() {
  if (unlocked) return
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    ctx.resume?.()
    unlocked = ctx.state === 'running' || true
  } catch { /* no audio support */ }
  if (unlocked) for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, unlock)
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock)

let last = 0
export function ding() {
  if (!enabled || !ctx) return
  const now = Date.now()
  if (now - last < 1200) return           // never play more than once per ~1 s (message bursts)
  last = now
  try {
    ctx.resume?.()
    const t = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    gain.connect(ctx.destination)
    for (const [freq, start] of [[880, 0], [1318.5, 0.12]]) {      // two soft notes (A5, E6)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t + start)
      osc.connect(gain)
      osc.start(t + start)
      osc.stop(t + start + 0.3)
    }
  } catch { /* ignore */ }
}

/* ---- tab title: "(3) LSDKChat" while you are away ---- */
const BASE = document.title
let count = 0
export function bumpTitle() { if (document.visibilityState === 'hidden') { count += 1; document.title = `(${count}) ${BASE}` } }
export function clearTitle() { count = 0; document.title = BASE }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') clearTitle() })

// Call for every new message that arrives from someone else.
export function notifyIncoming({ inCurrentRoom }) {
  const away = document.visibilityState === 'hidden'
  // Looking right at the chat: no sound. Anywhere else (other chat, other tab/window): ding.
  if (inCurrentRoom && !away) return
  ding()
  bumpTitle()
}

/* ---- ringtone for incoming calls (generated in the browser, no file needed) ---- */
let ringTimer = null
function ringOnce() {
  if (!ctx) return
  try {
    ctx.resume?.()
    const t = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.03)
    gain.gain.setValueAtTime(0.16, t + 0.5)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
    gain.connect(ctx.destination)
    for (const [f, s] of [[660, 0], [880, 0.25]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t + s)
      o.connect(gain); o.start(t + s); o.stop(t + s + 0.25)
    }
  } catch { /* ignore */ }
}
export function startRingtone() {
  stopRingtone()
  if (!enabled) return
  ringOnce(); ringTimer = setInterval(ringOnce, 2200)
}
export function stopRingtone() { if (ringTimer) clearInterval(ringTimer); ringTimer = null }
