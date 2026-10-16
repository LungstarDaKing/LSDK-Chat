// Vector artwork for the games. Everything is drawn with SVG (createElementNS, so it is CSP-safe and never parses
// strings as HTML) and looks the same on every phone and computer. Text symbols such as the chess glyphs are NOT used:
// phones turn some of them into coloured emoji.
const NS = 'http://www.w3.org/2000/svg'
export const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  parent?.append(e)
  return e
}

/* ---------------------------------------------------------------- chess pieces (45 x 45 box) */
// Each piece is a list of [kind, path] where kind 'b' = body (filled + outlined) and 'd' = detail line (outlined only).
const BASE = 'M10 39.5h25v-3.2c0-1.4-1.6-2.3-3-2.8H13c-1.4.5-3 1.4-3 2.8z'
const PIECES = {
  p: [
    ['b', 'M22.5 11.2a4.6 4.6 0 0 0-2.7 8.3c-2.6 1-4.3 3.2-4.3 5.8 0 1.5.6 2.8 1.6 3.8-2.7 1.6-4.4 4.6-4.4 6.2h20.6c0-1.6-1.7-4.6-4.4-6.2 1-1 1.6-2.3 1.6-3.8 0-2.6-1.7-4.8-4.3-5.8a4.6 4.6 0 0 0-2.7-8.3z'],
    ['b', BASE],
  ],
  r: [
    ['b', 'M12 33.5l1.8-3.2V19.6H12V9.5h5v3h3.2v-3h4.6v3H28v-3h5v10.1h-1.8v10.7l1.8 3.2z'],
    ['d', 'M13.8 19.6h17.4M13.8 30.3h17.4'],
    ['b', BASE],
  ],
  n: [
    ['b', 'M13.5 34c-.6-5.3 1.8-8.6 5.6-11.5-2.6-.7-5.6-2.1-7.7-4.3-1.3-1.4-1.3-3.2.2-4.6l3.6-3.4-.6-5.2 4.6 2.6c8.4.5 14.6 6.2 14.6 18 0 3.2-.9 6.1-1.6 8.4z'],
    ['d', 'M20.6 12.8l-1.4 3M27 17.6c3.2 2.6 4.3 6.4 3.9 10.2'],
    ['e', 'M17.7 15.6a1 1 0 1 0 .01 0z'],
    ['e', 'M13.4 19.6a.9.9 0 1 0 .01 0z'],
    ['b', BASE],
  ],
  b: [
    ['b', 'M22.5 6.2a2.4 2.4 0 1 1-.01 0z'],
    ['b', 'M22.5 9.6c-5 3.6-8.2 8.2-8.2 12.3 0 2.7 1.4 4.6 3.4 5.8L16 33.5h13l-1.7-5.8c2-1.2 3.4-3.1 3.4-5.8 0-4.1-3.2-8.7-8.2-12.3z'],
    ['d', 'M19.6 17.4l5.8 5.8M22.5 24.8v0'],
    ['b', BASE],
  ],
  q: [
    ['b', 'M9.6 14.2l3.8 14.6h18.2l3.8-14.6-5.8 8.6-3.4-10.6-3.6 10.4-3.6-10.4-3.4 10.6z'],
    ['b', 'M13.4 28.8c0 1.8-.6 3-1 4.7h22.2c-.4-1.7-1-2.9-1-4.7z'],
    ['b', 'M9.6 12.6a2.2 2.2 0 1 1-.01 0zM17.8 9.4a2.2 2.2 0 1 1-.01 0zM27.2 9.4a2.2 2.2 0 1 1-.01 0zM35.4 12.6a2.2 2.2 0 1 1-.01 0zM22.5 7.6a2.2 2.2 0 1 1-.01 0z'],
    ['b', BASE],
  ],
  k: [
    ['d', 'M22.5 3.4v8.6M18.6 6.9h7.8'],
    ['b', 'M22.5 28.2c0 0-7-9.6-7-14.6a5.2 5.2 0 0 1 7-4.8 5.2 5.2 0 0 1 7 4.8c0 5-7 14.6-7 14.6z'],
    ['b', 'M12.5 33.6c-.2-4.6 4-7 10-7s10.2 2.4 10 7z'],
    ['d', 'M22.5 12.4v14'],
    ['b', BASE],
  ],
}

// Builds one piece as an <svg>. color: 'w' | 'b'. The look comes from CSS (.pc.w / .pc.b) so it follows the theme.
export function pieceSvg(type, color) {
  const svg = svgEl('svg', { viewBox: '0 0 45 45', class: `pc ${color}`, 'aria-hidden': 'true', focusable: 'false' })
  for (const [kind, d] of PIECES[type]) {
    const p = svgEl('path', { d })
    p.setAttribute('class', kind === 'b' ? 'pc-body' : kind === 'e' ? 'pc-eye' : 'pc-line')
    svg.append(p)
  }
  return svg
}

/* ---------------------------------------------------------------- tic-tac-toe marks */
export function markSvg(mark, { win = false, fresh = false } = {}) {
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: `mark ${mark}${win ? ' win' : ''}${fresh ? ' new' : ''}`, 'aria-hidden': 'true', focusable: 'false' })
  if (mark === 'X') {
    svgEl('path', { d: 'M26 26L74 74', class: 'mk-s1', pathLength: 1 }, svg)
    svgEl('path', { d: 'M74 26L26 74', class: 'mk-s2', pathLength: 1 }, svg)
  } else {
    svgEl('circle', { cx: 50, cy: 50, r: 25, class: 'mk-o', pathLength: 1 }, svg)
  }
  return svg
}

/* ---------------------------------------------------------------- hangman gallows (scaffold + stickman) */
export function gallowsSvg(wrong, max = 7) {
  const svg = svgEl('svg', { viewBox: '0 0 140 150', class: 'gallows', role: 'img', 'aria-label': `${wrong} of ${max} wrong guesses` })
  const wood = svgEl('g', { class: 'g-wood' }, svg)
  svgEl('path', { d: 'M14 140h74' }, wood)                      // ground
  svgEl('path', { d: 'M36 140V14' }, wood)                       // post
  svgEl('path', { d: 'M34 14h72' }, wood)                        // beam
  svgEl('path', { d: 'M36 44l26-30' }, wood)                     // brace
  svgEl('path', { d: 'M104 14v22', class: 'g-rope' }, svg)       // rope
  const man = svgEl('g', { class: 'g-man' }, svg)
  const parts = [
    () => svgEl('circle', { cx: 104, cy: 46, r: 10 }, man),
    () => svgEl('path', { d: 'M104 56v36' }, man),
    () => svgEl('path', { d: 'M104 64l-17 15' }, man),
    () => svgEl('path', { d: 'M104 64l17 15' }, man),
    () => svgEl('path', { d: 'M104 92l-15 25' }, man),
    () => svgEl('path', { d: 'M104 92l15 25' }, man),
    () => { svgEl('path', { d: 'M99 42l4 4M103 42l-4 4M105 42l4 4M109 42l-4 4' }, man) },
  ]
  const n = Math.min(wrong, parts.length)
  for (let i = 0; i < n; i++) { const before = man.childNodes.length; parts[i](); for (let j = before; j < man.childNodes.length; j++) if (i === n - 1) man.childNodes[j].classList.add('new') }
  return svg
}

/* ---------------------------------------------------------------- darts */
export const dartElement = (parent, x, y, { fresh = false } = {}) => {
  // a small top-down dart: the tip sits exactly at (x, y); the barrel and flights trail off towards the thrower
  const g = svgEl('g', { class: `dart${fresh ? ' fresh' : ''}`, transform: `translate(${x} ${y})` }, parent)
  svgEl('path', { d: 'M0 0L-1.4 -8L1.4 -8Z', class: 'dt-tip' }, g)
  svgEl('rect', { x: -1.7, y: -17, width: 3.4, height: 9.5, rx: 1.4, class: 'dt-barrel' }, g)
  svgEl('path', { d: 'M0 -17L-6 -26L-1.2 -24.5L0 -29L1.2 -24.5L6 -26Z', class: 'dt-flight' }, g)
  return g
}
