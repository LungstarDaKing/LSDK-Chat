// Small hand-drawn icon set (24x24, 1.9px rounded strokes, inherits the text colour).
// Built with createElementNS so it is CSP-safe and never parses strings as HTML.
const NS = 'http://www.w3.org/2000/svg'
const c = (cx, cy, r, extra = {}) => ['circle', { cx, cy, r, ...extra }]
const r = (x, y, w, h, rx = 2.5) => ['rect', { x, y, width: w, height: h, rx }]
const p = (d, extra = {}) => ['path', { d, ...extra }]
const F = { fill: 'currentColor', stroke: 'none' }

const ICONS = {
  star: [p('M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5z')],
  sticker: [p('M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6l-7 7H7a3 3 0 0 1-3-3V7z'), p('M13 20v-4a3 3 0 0 1 3-3h4'), p('M9 9h.01'), p('M14 9h.01'), p('M9 12.5c.9 1 2.1 1.4 3 1.2')],
  sparkle: [p('M12 3l1.9 5.4L19.5 10l-5.6 1.6L12 17l-1.9-5.4L4.5 10l5.6-1.6z'), p('M19 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z')],
  chat: [p('M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6.2l-3.9 3.4a.6.6 0 0 1-1-.45V17H7a3 3 0 0 1-3-3z')],
  status: [c(12, 12, 9, { 'stroke-dasharray': '3.2 2.6' }), c(12, 12, 3.6, F)],
  phone: [p('M6.7 3.5h2.9l1.4 4-2 1.4a11 11 0 0 0 5.1 5.1l1.4-2 4 1.4v2.9a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.7 5.7a2 2 0 0 1 2-2.2z')],
  'phone-off': [p('M6.7 3.5h2.9l1.4 4-2 1.4a11 11 0 0 0 5.1 5.1l1.4-2 4 1.4v2.9a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.7 5.7a2 2 0 0 1 2-2.2z', { transform: 'rotate(135 12 12)' })],
  video: [r(3, 6.5, 12, 11, 3), p('M15 10.5l5.2-3v9l-5.2-3z')],
  'video-off': [p('M3 3l18 18'), p('M9.5 6.5H12a3 3 0 0 1 3 3v2.5M15 14.5V15a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9.5a3 3 0 0 1 1-2.2'), p('M15 10.5l5.2-3v9')],
  screen: [r(3, 4.5, 18, 12, 2.5), p('M8 20h8M12 16.5V20'), p('M9.5 11.2L12 8.7l2.5 2.5')],
  game: [r(2.5, 7, 19, 11, 5.5), p('M8 10v4M6 12h4'), c(15.5, 11.2, .9, F), c(17.8, 13.2, .9, F)],
  grid: [r(4, 4, 6.5, 6.5, 2), r(13.5, 4, 6.5, 6.5, 2), r(4, 13.5, 6.5, 6.5, 2), r(13.5, 13.5, 6.5, 6.5, 2)],
  user: [c(12, 8, 4), p('M4.5 20.5a7.5 7.5 0 0 1 15 0')],
  users: [c(9, 8.5, 3.5), p('M2.8 20a6.2 6.2 0 0 1 12.4 0'), p('M15.5 5.3a3.4 3.4 0 0 1 0 6.4M17.5 14.2A6.2 6.2 0 0 1 21.2 20')],
  search: [c(11, 11, 6.5), p('M16 16l4.5 4.5')],
  plus: [p('M12 5v14M5 12h14')],
  compose: [p('M4 20l1-4L16.2 4.8a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19z'), p('M14.5 6.5l3 3')],
  note: [p('M6 3.5h9l4 4V18a2.5 2.5 0 0 1-2.5 2.5h-10.5A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5z', { transform: 'translate(.5 0)' }), p('M15 3.5V8h4.5M7.5 12.5h8M7.5 16h5')],
  paperclip: [p('M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8')],
  mic: [r(9, 3, 6, 11, 3), p('M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21')],
  'mic-off': [p('M3 3l18 18'), p('M9 5.5A3 3 0 0 1 15 6v5M15 12.5a3 3 0 0 1-5.4 1.8M5.5 11a6.5 6.5 0 0 0 10.2 5.3M18.5 11a6.5 6.5 0 0 1-.6 2.7M12 17.5V21')],
  send: [p('M21 3L10.5 13.5'), p('M21 3l-6.7 18-3.8-7.5L3 9.7z')],
  clock: [c(12, 12, 9), p('M12 7v5.2l3.2 1.9')],
  alarm: [c(12, 13, 7.5), p('M12 9v4.2l2.6 1.6M4.5 5.2l2.7-2M19.5 5.2l-2.7-2')],
  info: [c(12, 12, 9), p('M12 11v5.2'), c(12, 7.9, .6, F)],
  back: [p('M19 12H5M11 6l-6 6 6 6')],
  x: [p('M6 6l12 12M18 6L6 18')],
  more: [c(5.5, 12, 1.5, F), c(12, 12, 1.5, F), c(18.5, 12, 1.5, F)],
  check: [p('M5 12.5l4.5 4.5L19 7.5')],
  checks: [p('M2.5 12.5l4.5 4.5 8.5-9.5M10.5 15.5l1.5 1.5L21.5 7.5')],
  reply: [p('M9.5 7.5L4 13l5.5 5.5'), p('M4 13h9.5A6.5 6.5 0 0 1 20 19.5')],
  smile: [c(12, 12, 9), p('M8.3 14.2a4.2 4.2 0 0 0 7.4 0'), c(9, 9.8, .5, F), c(15, 9.8, .5, F)],
  bookmark: [p('M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z')],
  download: [p('M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14')],
  trash: [p('M4 7h16M10 11v5.5M14 11v5.5M6 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h7.2a1.5 1.5 0 0 0 1.5-1.3L18 7M9 7V4.5h6V7')],
  flag: [p('M6 21V4M6 4.5h11.5l-2.3 4 2.3 4H6')],
  copy: [r(8.5, 8.5, 12, 12, 2.5), p('M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2')],
  play: [p('M8 5l11 7-11 7z', { fill: 'currentColor' })],
  pause: [r(6.5, 5, 3.8, 14, 1.2), r(13.7, 5, 3.8, 14, 1.2)],
  sliders: [p('M4 7h9M19 7h1M4 17h1M11 17h9'), c(16, 7, 2.5), c(8, 17, 2.5)],
  image: [r(3.5, 4.5, 17, 15, 3), c(9, 10, 1.7), p('M4 17l4.5-4.5 3.5 3.5 3-3 5 5')],
  file: [p('M6 3.5h8.5L19 8v12.5H6z', { transform: 'translate(0 -.5)' }), p('M14 3v5h5')],
  music: [p('M9 18V6.5l10-2V16'), c(6.5, 18, 2.5), c(16.5, 16, 2.5)],
  link: [p('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'), p('M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1')],
  waveform: [p('M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2')],
  down: [p('M6 9.5l6 6 6-6')],
  right: [p('M9.5 6l6 6-6 6')],
  sun: [c(12, 12, 4), p('M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4')],
  moon: [p('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z')],
  lock: [r(5, 10.5, 14, 10, 2.5), p('M8 10.5V8a4 4 0 0 1 8 0v2.5')],
  heart: [p('M12 20.5s-8-4.6-8-10.6A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 8 2.7c0 6-8 10.6-8 10.6z')],
  volume: [p('M4 9.5h3.5L12 5.5v13l-4.5-4H4z'), p('M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11')],
  eye: [p('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'), c(12, 12, 3)],
  inbox: [p('M3.5 13l2.7-7.2A2 2 0 0 1 8.1 4.5h7.8a2 2 0 0 1 1.9 1.3L20.5 13v4.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'), p('M3.5 13h5l1 2.5h5l1-2.5h5')],
  crown: [p('M4 18.5h16M4.5 17L3.5 8l5 4L12 5.5 15.5 12l5-4-1 9z')],
}

export function icon(name, size = 20, cls = '') {
  const svg = document.createElementNS(NS, 'svg')
  const set = (el, o) => { for (const [k, v] of Object.entries(o)) el.setAttribute(k, v) }
  set(svg, { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `ico ${cls}`.trim() })
  for (const [tag, attrs] of ICONS[name] || []) { const el = document.createElementNS(NS, tag); set(el, attrs); svg.append(el) }
  return svg
}
export const ICON_NAMES = Object.keys(ICONS)
