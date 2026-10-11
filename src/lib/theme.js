// Appearance: light/dark theme + chat background (stock or your own picture).
// Everything here is stored ONLY in this browser (localStorage); nothing is uploaded.
const K_THEME = 'lsdkchat.theme'
const K_BG = 'lsdkchat.bg'
const K_IMG = 'lsdkchat.bgimage'
const K_DIM = 'lsdkchat.bgdim'

const get = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true } catch { return false } }

const dots = (c) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Ccircle cx='6' cy='6' r='2' fill='${encodeURIComponent(c)}'/%3E%3Ccircle cx='28' cy='28' r='2' fill='${encodeURIComponent(c)}'/%3E%3C/svg%3E")`
const waves = (c) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='24'%3E%3Cpath d='M0 12 Q20 0 40 12 T80 12' fill='none' stroke='${encodeURIComponent(c)}' stroke-width='1.6'/%3E%3C/svg%3E")`

// `css` is a full CSS background value. `dark` tells the app which text colour fits best.
export const BACKGROUNDS = [
  { id: 'classic',  name: 'Classic',  css: 'var(--chat-plain)' },
  { id: 'dots',     name: 'Dots',     css: `${dots('#8b85ff55')}, var(--chat-plain)` },
  { id: 'waves',    name: 'Waves',    css: `${waves('#8b85ff44')}, var(--chat-plain)` },
  { id: 'aurora',   name: 'Aurora',   css: 'linear-gradient(160deg,#0f2027,#203a43 45%,#2c5364)', dark: true },
  { id: 'dusk',     name: 'Dusk',     css: 'linear-gradient(160deg,#1f1c4a,#3b2a6b 50%,#7b3f8f)', dark: true },
  { id: 'ocean',    name: 'Ocean',    css: 'linear-gradient(160deg,#a1c4fd,#c2e9fb)' },
  { id: 'sunset',   name: 'Sunset',   css: 'linear-gradient(160deg,#ffd6a5,#ffadad 55%,#fdc5f5)' },
  { id: 'mint',     name: 'Mint',     css: 'linear-gradient(160deg,#d4fc79,#96e6a1)' },
  { id: 'forest',   name: 'Forest',   css: 'linear-gradient(160deg,#134e5e,#71b280)', dark: true },
  { id: 'graphite', name: 'Graphite', css: 'linear-gradient(160deg,#232526,#414345)', dark: true },
]

export const THEMES = [{ id: 'system', name: 'System' }, { id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }]

export const getTheme = () => (['light', 'dark'].includes(get(K_THEME)) ? get(K_THEME) : 'system')
export const getBackgroundId = () => get(K_BG, 'classic')
export const getCustomImage = () => get(K_IMG, null)
export const getDim = () => Math.min(60, Math.max(0, parseInt(get(K_DIM, '25'), 10) || 0))

export function setTheme(t) { set(K_THEME, t === 'system' ? null : t); apply() }
export function setBackground(id) { set(K_BG, id); apply() }
export function setDim(n) { set(K_DIM, String(n)); apply() }
export function removeCustomImage() { set(K_IMG, null); if (getBackgroundId() === 'custom') set(K_BG, 'classic'); apply() }

// Resize to max 1600 px and re-save as JPEG so it fits in browser storage (and drops EXIF/GPS).
export async function setCustomImage(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.')
  if (file.size > 20 * 1024 * 1024) throw new Error('That picture is too large (max 20 MB).')
  let bmp
  try { bmp = await createImageBitmap(file) } catch { throw new Error('That picture could not be read.') }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
  if (!blob) throw new Error('That picture could not be processed.')
  const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob) })
  if (!set(K_IMG, url)) throw new Error('Your browser has no room to store that picture. Try a smaller one.')
  set(K_BG, 'custom')
  apply()
}

// ---- per-person chat background (this device only) ----
const K_PER = 'lsdkchat.bg.per'
const K_PIMG = 'lsdkchat.bgimage.'
let chatPeer = null
const perMap = () => { try { const o = JSON.parse(get(K_PER, '{}')); return o && typeof o === 'object' ? o : {} } catch { return {} } }
export const getPersonBg = (uid) => { const v = perMap()[uid]; return typeof v === 'string' ? v : null }   // null = use general
export function setPersonBg(uid, id) { const m = perMap(); if (id) m[uid] = id; else delete m[uid]; set(K_PER, JSON.stringify(m)); apply() }
export const getPersonImage = (uid) => get(K_PIMG + uid, null)
export function removePersonImage(uid) { set(K_PIMG + uid, null); if (getPersonBg(uid) === 'custom') setPersonBg(uid, null); else apply() }
export function setChatPeer(uid) { if (uid === chatPeer) return; chatPeer = uid || null; apply() }

async function toDataUrl(file, max, q) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.')
  if (file.size > 20 * 1024 * 1024) throw new Error('That picture is too large (max 20 MB).')
  let bmp
  try { bmp = await createImageBitmap(file) } catch { throw new Error('That picture could not be read.') }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q))
  if (!blob) throw new Error('That picture could not be processed.')
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob) })
}
export async function setPersonImage(uid, file) {
  const url = await toDataUrl(file, 1100, 0.7)
  if (!set(K_PIMG + uid, url)) throw new Error('Your browser has no room to store that picture. Try a smaller one.')
  setPersonBg(uid, 'custom')
}

// which background applies right now: this person's own choice, else the general one
const effectiveId = () => { const v = chatPeer && getPersonBg(chatPeer); return v && (v !== 'custom' || getPersonImage(chatPeer)) ? v : getBackgroundId() }
const effectiveImage = () => (effectiveId() === getPersonBg(chatPeer) && getPersonBg(chatPeer) === 'custom' ? getPersonImage(chatPeer) : getCustomImage())

export function backgroundCss(id = getBackgroundId(), dim = getDim(), img = getCustomImage()) {
  if (id === 'custom' && img) {
    const d = (dim / 100).toFixed(2)
    return `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})), url("${img}") center / cover no-repeat`
  }
  const bg = BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0]
  return bg.css
}

export function apply() {
  const root = document.documentElement
  const t = getTheme()
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t)
  const id = effectiveId()
  root.style.setProperty('--chat-bg', backgroundCss(id, getDim(), effectiveImage()))
  const dark = id === 'custom' ? true : !!BACKGROUNDS.find((b) => b.id === id)?.dark
  root.dataset.chatbg = id === 'classic' || id === 'dots' || id === 'waves' ? 'plain' : dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--accent').trim() || '#4f46e5')
}
apply()
