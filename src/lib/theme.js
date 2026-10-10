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

export function backgroundCss(id = getBackgroundId(), dim = getDim()) {
  if (id === 'custom' && getCustomImage()) {
    const d = (dim / 100).toFixed(2)
    return `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})), url("${getCustomImage()}") center / cover no-repeat`
  }
  const bg = BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0]
  return bg.css
}

export function apply() {
  const root = document.documentElement
  const t = getTheme()
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t)
  root.style.setProperty('--chat-bg', backgroundCss())
  const id = getBackgroundId()
  const dark = id === 'custom' ? true : !!BACKGROUNDS.find((b) => b.id === id)?.dark
  root.dataset.chatbg = id === 'classic' || id === 'dots' || id === 'waves' ? 'plain' : dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--accent').trim() || '#4f46e5')
}
apply()
