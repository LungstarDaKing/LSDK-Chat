// Ringtones for incoming calls: built-in tones (generated in the browser, no files) or your own
// audio files. Choices are kept ONLY on this device (localStorage + IndexedDB); nothing is uploaded.
import { getAudioContext, soundEnabled } from './sound.js'
import { prepareFile, mediaDuration } from './media.js'

// [frequency Hz, start s, length s]; the pattern repeats every `every` ms.
export const STOCK = [
  { id: 'classic', name: 'Classic', every: 2200, notes: [[660, 0, .25], [880, .25, .25]] },
  { id: 'marimba', name: 'Marimba', every: 2400, notes: [[523, 0, .2], [659, .2, .2], [784, .4, .2], [1047, .6, .35]], type: 'triangle' },
  { id: 'chime', name: 'Chime', every: 2600, notes: [[1319, 0, .5], [988, .35, .6]] },
  { id: 'pulse', name: 'Pulse', every: 1500, notes: [[440, 0, .12], [440, .22, .12], [440, .44, .12]], type: 'square', vol: .06 },
  { id: 'rise', name: 'Sunrise', every: 2600, notes: [[392, 0, .25], [494, .25, .25], [587, .5, .25], [784, .75, .45]] },
  { id: 'bubbles', name: 'Bubbles', every: 2000, notes: [[900, 0, .08], [1200, .12, .08], [1500, .24, .08], [1100, .5, .08], [1400, .62, .08]], type: 'sine' },
]
const K_PREFS = 'lsdkchat.ringtones', K_CUSTOM = 'lsdkchat.tones'
export const MAX_CUSTOM = 5, MAX_TONE_BYTES = 3 * 1024 * 1024, MAX_TONE_SECONDS = 30

const lget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } }

export const getPrefs = () => { const p = lget(K_PREFS, {}); return { def: typeof p.def === 'string' ? p.def : 'classic', per: p.per && typeof p.per === 'object' ? p.per : {} } }
export const setDefaultTone = (id) => { const p = getPrefs(); p.def = id; lset(K_PREFS, p) }
export const setPersonTone = (uid, id) => { const p = getPrefs(); if (id) p.per[uid] = id; else delete p.per[uid]; lset(K_PREFS, p) }
export const listCustom = () => lget(K_CUSTOM, []).filter((t) => t && typeof t.id === 'string')
export const toneName = (id) => STOCK.find((t) => t.id === id)?.name || listCustom().find((t) => t.id === id)?.name || 'Classic'
export const toneFor = (peerId) => { const p = getPrefs(); return p.per[peerId] || p.def }

/* ---- IndexedDB store for custom tones ---- */
const db = () => new Promise((res, rej) => {
  const r = indexedDB.open('lsdkchat', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('tones')
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
})
const idb = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('tones', mode); const rq = fn(tx.objectStore('tones')); tx.oncomplete = () => { d.close(); res(rq?.result) }; tx.onerror = () => { d.close(); rej(tx.error) } }) }

export async function addCustomTone(file) {
  const list = listCustom()
  if (list.length >= MAX_CUSTOM) throw new Error(`You can keep up to ${MAX_CUSTOM} of your own ringtones. Remove one first.`)
  if (!file?.type?.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg|oga|weba)$/i.test(file?.name || '')) throw new Error('Choose an audio file (MP3, M4A, WAV, OGG...).')
  if (file.size > MAX_TONE_BYTES) throw new Error('That file is too big for a ringtone (max 3 MB).')
  const p = await prepareFile(file)                                    // type + content checks
  if (!p.type.startsWith('audio/')) throw new Error('Choose an audio file.')
  const secs = await mediaDuration(new File([p.body], p.name, { type: p.type }))
  if (secs == null) throw new Error('That audio file could not be read by your browser.')
  if (secs > MAX_TONE_SECONDS * 1000) throw new Error(`Ringtones can be at most ${MAX_TONE_SECONDS} seconds long.`)
  const id = 'c_' + crypto.randomUUID()
  await idb('readwrite', (s) => s.put(new Blob([p.body], { type: p.type }), id))
  const name = p.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'My ringtone'
  if (!lset(K_CUSTOM, [...list, { id, name }])) throw new Error('Could not save the ringtone in this browser.')
  return { id, name }
}
export async function removeCustomTone(id) {
  await idb('readwrite', (s) => s.delete(id)).catch(() => {})
  lset(K_CUSTOM, listCustom().filter((t) => t.id !== id))
  const p = getPrefs()
  if (p.def === id) p.def = 'classic'
  for (const u of Object.keys(p.per)) if (p.per[u] === id) delete p.per[u]
  lset(K_PREFS, p)
}

/* ---- playback ---- */
let current = null
export function stopRingtone() { try { current?.() } catch { /* ignore */ } current = null }

// Returns a stop() function. `loop` = keep repeating (incoming call); false = one preview play.
export async function playTone(id, { loop = true, force = false } = {}) {
  stopRingtone()
  if (!force && !soundEnabled()) return () => {}
  const custom = listCustom().find((t) => t.id === id)
  let stopped = false, timer = null, audio = null, url = null
  const stop = () => { stopped = true; clearInterval(timer); if (audio) { audio.pause(); audio.src = '' } if (url) URL.revokeObjectURL(url) }
  current = stop
  if (custom) {
    try {
      const blob = await idb('readonly', (s) => s.get(id))
      if (blob && !stopped) { url = URL.createObjectURL(blob); audio = new Audio(url); audio.loop = loop; await audio.play(); return stop }
    } catch { /* fall through to the built-in tone */ }
    if (stopped) return stop
  }
  const tone = STOCK.find((t) => t.id === id) || STOCK[0]
  const ctx = getAudioContext()
  if (!ctx) return stop
  const once = () => {
    if (stopped) return
    try {
      ctx.resume?.()
      const t0 = ctx.currentTime, g = ctx.createGain(), vol = tone.vol ?? .16
      g.gain.setValueAtTime(vol, t0); g.connect(ctx.destination)
      for (const [f, s, d] of tone.notes) {
        const o = ctx.createOscillator(), e = ctx.createGain()
        o.type = tone.type || 'sine'; o.frequency.setValueAtTime(f, t0 + s)
        e.gain.setValueAtTime(0.0001, t0 + s); e.gain.exponentialRampToValueAtTime(1, t0 + s + .02); e.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d + .15)
        o.connect(e); e.connect(g); o.start(t0 + s); o.stop(t0 + s + d + .2)
      }
    } catch { /* ignore */ }
  }
  once()
  if (loop) timer = setInterval(once, tone.every)
  return stop
}

export async function startRingtone(peerId) { await playTone(toneFor(peerId), { loop: true }) }
export async function previewTone(id) { const stop = await playTone(id, { loop: false, force: true }); setTimeout(stop, 3500); return stop }
