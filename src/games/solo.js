// Games you play on your own. Nothing is stored on a server; the best score stays in this browser.
import { h, clear } from '../lib/dom.js'

const best = {
  get: (k) => { try { return Number(localStorage.getItem('lsdk-best-' + k)) || 0 } catch { return 0 } },
  set: (k, v) => { try { localStorage.setItem('lsdk-best-' + k, String(v)) } catch { /* private mode */ } },
}
export const pick = (arr, n, rng = Math.random) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a.slice(0, n) }

/* ============ Emoji song challenge ============ */
export const SONGS = [
  ['🙏🌍💃', 'Jerusalema'], ['🧟🕺🌕', 'Thriller'], ['😀☀️👏', 'Happy'], ['☔🌧️', 'Umbrella'], ['💡😵🌃', 'Blinding Lights'],
  ['⚽🕺🌍', 'Waka Waka'], ['🐒💃', 'Dance Monkey'], ['🐴🛣️🤠', 'Old Town Road'], ['🎆🔥', 'Firework'], ['🌴🇨🇺', 'Havana'],
  ['🦁😴🌙', 'The Lion Sleeps Tonight'], ['👋☎️', 'Hello'], ['😈🧑', 'Bad Guy'], ['🌊🛞🎲', 'Rolling in the Deep'], ['🫨🚫', 'Shake It Off'],
  ['🌍🌅🥁', 'Africa'], ['📖❤️👗', 'Love Story'], ['🦁🗣️', 'Roar'], ['🙇😔', 'Sorry'], ['🪲✨', 'Fireflies'],
  ['⬆️🏙️🕺', 'Uptown Funk'], ['🐢🎶', 'Despacito'], ['👣🖐️', 'Pata Pata'], ['🌫️🌊', 'Faded'], ['🪩🌙🚀', 'Starboy'],
]
export function songRound(rng = Math.random) {
  const [emoji, answer] = pick(SONGS, 1, rng)[0]
  const wrong = pick(SONGS.filter((s) => s[1] !== answer), 3, rng).map((s) => s[1])
  return { emoji, answer, options: pick([answer, ...wrong], 4, rng) }
}
export function mountEmojiSong(box, { rounds = 10 } = {}) {
  let n = 0, score = 0, done = false
  const seen = new Set()
  const draw = () => {
    clear(box)
    if (n >= rounds) {
      const b = Math.max(best.get('emoji'), score); best.set('emoji', b)
      box.append(h('div', { class: 'g-end' }, h('h3', {}, `You got ${score} of ${rounds}`), h('p', { class: 'small' }, `Best on this device: ${b}`),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { n = 0; score = 0; seen.clear(); draw() } }, 'Play again')))
      return
    }
    let r; do { r = songRound() } while (seen.has(r.answer)); seen.add(r.answer)
    const fb = h('p', { class: 'g-feedback', 'aria-live': 'polite' })
    const opts = r.options.map((o) => h('button', { class: 'btn g-opt', type: 'button', onclick: (e) => {
      if (done) return; done = true
      const right = o === r.answer; if (right) score++
      for (const bt of opts) { bt.disabled = true; if (bt.textContent === r.answer) bt.classList.add('right') }
      if (!right) e.currentTarget.classList.add('wrong')
      fb.textContent = right ? 'Yes!' : `It was ${r.answer}`
      setTimeout(() => { done = false; n++; draw() }, 1100)
    } }, o))
    box.append(h('p', { class: 'small' }, `Round ${n + 1} of ${rounds} · Score ${score}`), h('div', { class: 'g-emoji', 'aria-label': 'Emoji clue' }, r.emoji),
      h('p', {}, 'Which song is this?'), h('div', { class: 'g-opts' }, opts), fb)
  }
  draw()
  return () => { done = true }
}

/* ============ Word puzzles (unscramble) ============ */
export const WORDS = [
  ['UBUNTU', 'Philosophy: I am because we are'], ['SPRINGBOK', 'National rugby team'], ['BILTONG', 'Dried cured meat'], ['BRAAI', 'Weekend fire and meat'],
  ['KWAITO', 'Music born in Johannesburg'], ['AMAPIANO', 'Piano-driven dance music'], ['JOHANNESBURG', 'City of gold'], ['TABLEMOUNTAIN', 'Flat-topped landmark in Cape Town'],
  ['SOWETO', 'Township with a famous 1976 uprising'], ['LOADSHEDDING', 'Scheduled power cuts'], ['ROBBENISLAND', 'Where Mandela was held'], ['VUVUZELA', 'Loud football horn'],
  ['PROTEA', 'National flower'], ['KRUGER', 'Famous game park'], ['RAINBOW', 'Colourful arc, and a nation'], ['KEYBOARD', 'You are using one'], ['NETWORK', 'Connected computers'],
  ['DATABASE', 'Organised store of records'], ['BROWSER', 'Opens websites'], ['MESSAGE', 'What you send in a chat'], ['PASSWORD', 'Keep it secret'], ['CAMERA', 'Takes photos'],
  ['GUITAR', 'Six strings'], ['MELODY', 'The tune'], ['RHYTHM', 'The beat pattern'], ['HARMONY', 'Notes sounding together'], ['PLAYLIST', 'Songs lined up'],
  ['ELEPHANT', 'Largest land animal'], ['GIRAFFE', 'Tallest animal'], ['RHINOCEROS', 'Horned animal'], ['SPRINGBUCK', 'Leaping antelope'], ['PENGUIN', 'Flightless bird that swims'],
  ['UNIVERSITY', 'Where you study after school'], ['LECTURE', 'Class given by a professor'], ['ASSIGNMENT', 'Work to hand in'], ['SEMESTER', 'Half an academic year'], ['LIBRARY', 'Quiet place full of books'],
]
export function scramble(word, rng = Math.random) {
  const letters = word.split('')
  for (let tries = 0; tries < 20; tries++) {
    for (let i = letters.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [letters[i], letters[j]] = [letters[j], letters[i]] }
    if (letters.join('') !== word) break
  }
  return letters.join('')
}
export const sameWord = (a, b) => String(a).trim().toUpperCase() === String(b).trim().toUpperCase()
export function mountWordPuzzle(box, { rounds = 8 } = {}) {
  let n = 0, score = 0, list = pick(WORDS, rounds)
  const draw = () => {
    clear(box)
    if (n >= rounds) {
      const b = Math.max(best.get('word'), score); best.set('word', b)
      box.append(h('div', { class: 'g-end' }, h('h3', {}, `Score ${score}`), h('p', { class: 'small' }, `Best on this device: ${b}`),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { n = 0; score = 0; list = pick(WORDS, rounds); draw() } }, 'Play again')))
      return
    }
    const [word, hint] = list[n]; let hinted = false
    const tiles = h('div', { class: 'g-tiles', 'aria-label': 'Scrambled letters' }, scramble(word).split('').map((l) => h('span', { class: 'g-tile' }, l)))
    const input = h('input', { type: 'text', maxLength: word.length + 2, autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Your answer', placeholder: 'Type the word' })
    const fb = h('p', { class: 'g-feedback', 'aria-live': 'polite' })
    const hintEl = h('p', { class: 'small' })
    const next = (msg) => { fb.textContent = msg; input.disabled = true; setTimeout(() => { n++; draw() }, 1100) }
    const form = h('form', { class: 'g-form', onsubmit: (e) => {
      e.preventDefault()
      if (sameWord(input.value, word)) { score += hinted ? 1 : 2; next('Correct!') } else { fb.textContent = 'Not quite. Try again.'; input.select() }
    } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Check'))
    box.append(h('p', { class: 'small' }, `Word ${n + 1} of ${rounds} · Score ${score}`), tiles, hintEl, form, fb,
      h('div', { class: 'g-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { hinted = true; hintEl.textContent = `Hint: ${hint}. Starts with ${word[0]}. (Worth 1 point now)` } }, 'Hint'),
        h('button', { class: 'btn small', type: 'button', onclick: () => next(`It was ${word}`) }, 'Skip')))
    input.focus()
  }
  draw()
  return () => {}
}

/* ============ Stickman run (tap, click or press Space to jump) ============ */
export function stickmanStep(st, dt) {
  // pure game step so it can be tested
  const g = 2600, jump = 900
  if (st.dead) return st
  st.t += dt; st.speed = 300 + Math.min(300, st.t * 12)
  if (st.jumpReq && st.y === 0) { st.vy = jump }
  st.jumpReq = false
  if (st.y > 0 || st.vy > 0) { st.vy -= g * dt; st.y = Math.max(0, st.y + st.vy * dt); if (st.y === 0) st.vy = 0 }
  for (const o of st.obs) o.x -= st.speed * dt
  st.obs = st.obs.filter((o) => o.x + o.w > -10)
  st.gap -= st.speed * dt
  if (st.gap <= 0) { st.obs.push({ x: 560, w: 18 + st.rng() * 16, h: 24 + st.rng() * 30 }); st.gap = 260 + st.rng() * 260 }
  st.score = Math.floor(st.t * 10)
  // stickman box: x 50..70, feet at y (above ground), height 46
  for (const o of st.obs) if (o.x < 70 && o.x + o.w > 50 && st.y < o.h) { st.dead = true }
  return st
}
export const newStickman = (rng = Math.random) => ({ t: 0, y: 0, vy: 0, speed: 300, obs: [], gap: 300, score: 0, dead: false, jumpReq: false, rng })
export function mountStickman(box) {
  const W = 560, H = 220, GROUND = 180
  const canvas = h('canvas', { class: 'g-canvas', width: W, height: H, tabIndex: 0, role: 'img', 'aria-label': 'Stickman runner. Tap, click or press Space to jump.' })
  const info = h('p', { class: 'small' }, 'Tap, click or press Space to jump.')
  box.append(canvas, info)
  const ctx = canvas.getContext('2d')
  let st = newStickman(), last = 0, raf = 0, started = false
  const jump = () => { if (st.dead) { st = newStickman(); started = true; return } started = true; st.jumpReq = true }
  const key = (e) => { if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); jump() } }
  canvas.addEventListener('pointerdown', jump); canvas.addEventListener('keydown', key); document.addEventListener('keydown', key)
  const draw = () => {
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#15102B'; ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#6B46F5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, GROUND + .5); ctx.lineTo(W, GROUND + .5); ctx.stroke()
    ctx.fillStyle = '#F5B83D'; for (const o of st.obs) ctx.fillRect(o.x, GROUND - o.h, o.w, o.h)
    const x = 60, y = GROUND - st.y, run = Math.sin(st.t * 18) * 8
    ctx.strokeStyle = st.dead ? '#e5334b' : '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(x, y - 40, 7, 0, Math.PI * 2); ctx.moveTo(x, y - 33); ctx.lineTo(x, y - 14)           // head, body
    ctx.moveTo(x, y - 28); ctx.lineTo(x + 10 + run / 2, y - 20); ctx.moveTo(x, y - 28); ctx.lineTo(x - 10 - run / 2, y - 20)  // arms
    ctx.moveTo(x, y - 14); ctx.lineTo(x + 8 + (st.y ? 4 : run), y); ctx.moveTo(x, y - 14); ctx.lineTo(x - 8 - (st.y ? 4 : run), y) // legs
    ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.font = '600 16px sans-serif'; ctx.fillText(`Score ${st.score}`, 12, 24); ctx.fillText(`Best ${Math.max(best.get('stick'), st.score)}`, W - 100, 24)
    if (!started) { ctx.textAlign = 'center'; ctx.fillText('Tap to start', W / 2, 80); ctx.textAlign = 'left' }
    if (st.dead) { ctx.textAlign = 'center'; ctx.fillText('Ouch. Tap to try again', W / 2, 80); ctx.textAlign = 'left' }
  }
  const loop = (ts) => {
    const dt = Math.min(.05, (ts - (last || ts)) / 1000); last = ts
    if (started && !st.dead) { stickmanStep(st, dt); if (st.dead) best.set('stick', Math.max(best.get('stick'), st.score)) }
    draw(); raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', key) }
}

export const SOLO = [
  { id: 'stickman', title: 'Stickman run', blurb: 'Jump the blocks. How far can you get?', mount: mountStickman },
  { id: 'emoji', title: 'Emoji song challenge', blurb: 'Guess the song from the emojis.', mount: mountEmojiSong },
  { id: 'word', title: 'Word puzzles', blurb: 'Unscramble the letters.', mount: mountWordPuzzle },
]
