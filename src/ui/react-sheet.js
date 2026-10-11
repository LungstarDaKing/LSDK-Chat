import { h, clear } from '../lib/dom.js'
import { QUICK, CATEGORIES } from '../lib/emoji.js'

const HOLD_MS = 450
// Press-and-hold (touch / mouse) or right-click (desktop) on `el` calls `fn(el)`.
export function attachHold(el, fn) {
  let t = null, x = 0, y = 0
  const cancel = () => { clearTimeout(t); t = null }
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('a, input, textarea, audio, .vp-bar, .vp-btn, .vp-speed, .msg-actions, .reactions, .file-chip, .edit-input')) return
    x = e.clientX; y = e.clientY
    t = setTimeout(() => { t = null; fn(el) }, HOLD_MS)
  })
  el.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel() })
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, cancel)
  el.addEventListener('contextmenu', (e) => { if (e.target.closest('input, textarea')) return; e.preventDefault(); cancel(); fn(el) })
}

let open = null
export const closeReactSheet = () => { open?.(); open = null }

// current: the emoji I already reacted with (highlighted). actions: [{ label, icon, danger, onClick }]
export function openReactSheet({ anchor, current, onPick, actions = [] }) {
  closeReactSheet()
  const prevFocus = document.activeElement
  const quick = h('div', { class: 'rs-quick', role: 'group', 'aria-label': 'Quick reactions' })
  const full = h('div', { class: 'rs-full', hidden: true })
  const emojiBtn = (e) => h('button', { type: 'button', class: `rs-emoji${e === current ? ' on' : ''}`, 'aria-label': `React ${e}`, 'aria-pressed': String(e === current), onclick: () => { close(); onPick(e) } }, e)
  for (const e of QUICK) quick.append(emojiBtn(e))
  const more = h('button', { type: 'button', class: 'rs-emoji rs-more', 'aria-label': 'More reactions', 'aria-expanded': 'false', onclick: () => {
    full.hidden = !full.hidden; more.setAttribute('aria-expanded', String(!full.hidden)); more.textContent = full.hidden ? '＋' : '✕'
    reposition()
  } }, '＋')
  quick.append(more)
  const tabs = h('div', { class: 'rs-tabs', role: 'tablist' })
  const grid = h('div', { class: 'rs-grid' })
  const sections = {}
  for (const c of CATEGORIES) {
    const sec = h('section', { class: 'rs-sec' }, h('h3', {}, c.name), h('div', { class: 'rs-row' }, c.list.map(emojiBtn)))
    sections[c.id] = sec; grid.append(sec)
    tabs.append(h('button', { type: 'button', class: 'rs-tab', role: 'tab', 'aria-label': c.name, title: c.name, onclick: () => sec.scrollIntoView({ block: 'start' }) }, c.icon))
  }
  full.append(tabs, grid)
  const list = h('div', { class: 'rs-actions' }, actions.filter(Boolean).map((a) => h('button', { type: 'button', class: `rs-action${a.danger ? ' danger' : ''}`, onclick: () => { close(); a.onClick() } }, h('span', { 'aria-hidden': 'true' }, a.icon || ''), a.label)))
  const sheet = h('div', { class: 'react-sheet', role: 'dialog', 'aria-label': 'React to message', tabIndex: -1 }, quick, full, list)
  const scrim = h('div', { class: 'rs-scrim' })

  function reposition() {
    if (window.innerWidth <= 760) return                    // bottom sheet on phones (CSS)
    const r = anchor.getBoundingClientRect(), w = sheet.offsetWidth, hgt = sheet.offsetHeight
    let top = r.top - hgt - 8
    if (top < 8) top = Math.min(window.innerHeight - hgt - 8, r.bottom + 8)
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
    sheet.style.top = Math.max(8, top) + 'px'; sheet.style.left = left + 'px'
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
  function close() {
    document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', close)
    sheet.remove(); scrim.remove(); open = null; prevFocus?.focus?.()
  }
  scrim.addEventListener('pointerdown', close)
  document.addEventListener('keydown', onKey, true); window.addEventListener('resize', close)
  document.body.append(scrim, sheet)
  reposition(); sheet.querySelector('.rs-emoji')?.focus()
  open = close
  return close
}
