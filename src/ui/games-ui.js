import { Chess } from 'chess.js'
import { h, clear, toast, dialog, friendlyError } from '../lib/dom.js'
import { icon } from './icons.js'
import { VERSUS, gameApi, tttPlay, tttWinner, twentyAsk, twentyAnswer, TWENTY_MAX, maskLetters, resultLine } from '../lib/games.js'
import { SOLO } from '../games/solo.js'

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const FILES = 'abcdefgh'

/* ---------------- a running two-player game ---------------- */
export class GameSession {
  constructor(ctx, game) { this.ctx = ctx; this.game = game; this.me = ctx.me.id; this.sel = null; this.secret = null; this.dlg = null }
  open() {
    this.body = h('div', { class: 'game' })
    this.dlg = dialog({ title: VERSUS[this.game.kind].title, body: this.body, wide: true, actions: [], onClose: () => { this.dead = true; this.ctx.games?.sessionClosed(this) } })
    this.render(); this.loadSecret()
    return this
  }
  update(row) {
    if (this.dead || row.id !== this.game.id || row.version < this.game.version) return
    const wasDone = this.game.status === 'done'
    this.game = row; this.sel = null
    if (!wasDone && row.status === 'done') this.loadSecret()
    this.render()
  }
  async loadSecret() {
    const k = this.game.kind
    if (k !== 'hangman' && k !== 'twenty') return
    try { this.secret = await gameApi.secret(this.game.id); if (!this.dead) this.render() } catch { /* ignore */ }
  }
  get mine() { return this.game.turn === this.me && this.game.status === 'active' }
  other() { return this.game.p1 === this.me ? this.game.p2 : this.game.p1 }
  async act(fn) {
    try { await fn(); this.update(await gameApi.get(this.game.id)) }
    catch (e) { toast(friendlyError(e), 'error'); try { this.update(await gameApi.get(this.game.id)) } catch { /* ignore */ } }
  }
  send(r) { if (!r) return; return this.act(() => gameApi.move(this.game.id, this.game.version, r.state, r.status, r.winner, r.result)) }
  statusText() {
    const g = this.game, nm = (id) => this.ctx.nameOf(id)
    if (g.status === 'done') return resultLine(g, this.me, nm)
    if (g.kind === 'hangman') return g.turn === this.me ? 'Pick a letter' : `${nm(g.turn)} is guessing your word`
    return this.mine ? 'Your turn' : `Waiting for ${nm(g.turn)}`
  }
  render() {
    const g = this.game
    clear(this.body)
    this.body.append(h('p', { class: `g-status${this.mine ? ' mine' : ''}`, 'aria-live': 'polite' }, `vs ${this.ctx.nameOf(this.other())} · `, h('b', {}, this.statusText())))
    const view = { ttt: () => this.ttt(), chess: () => this.chess(), hangman: () => this.hangman(), twenty: () => this.twenty() }[g.kind]
    this.body.append(view())
    this.body.append(h('div', { class: 'g-row' }, g.status === 'active'
      ? h('button', { class: 'btn small danger', type: 'button', onclick: () => this.act(() => gameApi.resign(g.id)) }, 'Give up')
      : h('button', { class: 'btn primary small', type: 'button', onclick: () => this.rematch() }, 'Play again'),
      h('button', { class: 'btn small', type: 'button', onclick: () => this.dlg.close() }, 'Close')))
  }
  async rematch() {
    const k = this.game.kind, room = this.game.room_id
    this.dlg.close()
    this.ctx.games?.startGame(room, k)
  }

  /* --- tic-tac-toe --- */
  ttt() {
    const g = this.game, board = g.state.board || [], win = tttWinner(board)?.line || []
    const myMark = this.me === g.p1 ? 'X' : 'O'
    return h('div', {},
      h('p', { class: 'small' }, `You are ${myMark}`),
      h('div', { class: 'ttt', role: 'grid', 'aria-label': 'Tic-tac-toe board' }, board.map((v, i) =>
        h('button', { class: `ttt-cell${win.includes(i) ? ' win' : ''}${v ? ' ' + v : ''}`, type: 'button', role: 'gridcell', disabled: !this.mine || !!v,
          'aria-label': `Square ${i + 1}${v ? ', ' + v : ', empty'}`, onclick: () => this.send(tttPlay(g, i, this.me)) }, v || ''))))
  }

  /* --- chess --- */
  chess() {
    const g = this.game, chess = new Chess(g.state.fen), white = this.me === g.p1, myColor = white ? 'w' : 'b'
    const targets = this.sel ? chess.moves({ square: this.sel, verbose: true }).map((m) => m.to) : []
    const last = g.state.last || {}
    const kingInCheck = chess.inCheck() ? chess.board().flat().find((p) => p && p.type === 'k' && p.color === chess.turn())?.square : null
    const rows = white ? [...chess.board()] : [...chess.board()].reverse().map((r) => [...r].reverse())
    const cells = []
    rows.forEach((row, ri) => row.forEach((p, ci) => {
      const file = white ? ci : 7 - ci, rank = white ? 8 - ri : ri + 1, sq = FILES[file] + rank
      const dark = (file + rank) % 2 === 1
      cells.push(h('button', { type: 'button', role: 'gridcell', class: `cs ${dark ? 'dark' : 'light'}${this.sel === sq ? ' sel' : ''}${targets.includes(sq) ? ' target' : ''}${sq === last.from || sq === last.to ? ' last' : ''}${sq === kingInCheck ? ' check' : ''}`,
        'aria-label': `${sq}${p ? ' ' + (p.color === 'w' ? 'white' : 'black') + ' ' + p.type : ''}`, disabled: !this.mine,
        onclick: () => this.chessClick(chess, sq, myColor) }, p ? h('span', { class: `pc ${p.color}` }, GLYPH[p.type]) : null))
    }))
    const hist = g.state.moves || []
    return h('div', {}, h('p', { class: 'small' }, `You play ${white ? 'white' : 'black'}${chess.inCheck() && g.status === 'active' ? ' · Check!' : ''}`),
      h('div', { class: 'chess', role: 'grid', 'aria-label': 'Chess board' }, cells),
      h('p', { class: 'small g-moves' }, hist.length ? hist.slice(-12).join(' ') : 'No moves yet'))
  }
  chessClick(chess, sq, myColor) {
    if (!this.mine) return
    const piece = chess.get(sq)
    if (this.sel && chess.moves({ square: this.sel, verbose: true }).some((m) => m.to === sq)) {
      const mv = chess.move({ from: this.sel, to: sq, promotion: 'q' })    // pawns that reach the end become queens
      const moves = [...(this.game.state.moves || []), mv.san]
      const state = { fen: chess.fen(), moves, last: { from: mv.from, to: mv.to } }
      if (chess.isCheckmate()) return this.send({ state, status: 'done', winner: this.me, result: 'Checkmate' })
      if (chess.isDraw()) return this.send({ state, status: 'done', winner: null, result: chess.isStalemate() ? 'Stalemate' : 'Draw' })
      return this.send({ state, status: 'active', winner: null, result: null })
    }
    this.sel = piece && piece.color === myColor ? sq : null
    this.render()
  }

  /* --- hangman --- */
  hangman() {
    const g = this.game, st = g.state, wrong = st.wrong || [], guesser = g.p2 === this.me
    const word = st.word || (g.p1 === this.me ? this.secret : null)
    const tried = new Set([...(st.right || []), ...wrong])
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => h('button', { type: 'button', class: `key${wrong.includes(l) ? ' bad' : st.right?.includes(l) ? ' good' : ''}`,
      disabled: !(guesser && this.mine) || tried.has(l), onclick: () => this.act(() => gameApi.guess(g.id, l)) }, l))
    return h('div', {},
      this.gallows(wrong.length, st.max || 7),
      h('div', { class: 'hang-word', 'aria-label': `Word: ${maskLetters(st.mask).join(' ')}` }, maskLetters(st.mask).map((c) => h('span', { class: 'hl' }, c === '_' ? '' : c))),
      h('p', { class: 'small' }, `Wrong: ${wrong.join(' ') || 'none'} · ${Math.max(0, (st.max || 7) - wrong.length)} tries left`),
      g.status === 'done' ? h('p', {}, 'The word was ', h('b', {}, st.word || '')) : (g.p1 === this.me && word ? h('p', { class: 'small' }, 'Your word: ', h('b', {}, word)) : null),
      guesser ? h('div', { class: 'keys' }, keys) : null)
  }
  gallows(n, max) {
    // draws one more part of the stickman for each wrong guess
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('class', 'gallows'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${n} of ${max} wrong`)
    const add = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); svg.append(e) }
    const L = (x1, y1, x2, y2) => add('line', { x1, y1, x2, y2 })
    L(10, 112, 70, 112); L(30, 112, 30, 12); L(30, 12, 80, 12); L(80, 12, 80, 26)                // gallows
    const parts = [() => add('circle', { cx: 80, cy: 34, r: 8, fill: 'none' }), () => L(80, 42, 80, 72), () => L(80, 50, 66, 62), () => L(80, 50, 94, 62), () => L(80, 72, 68, 92), () => L(80, 72, 92, 92), () => { L(75, 31, 78, 34); L(78, 31, 75, 34); L(82, 31, 85, 34); L(85, 31, 82, 34) }]
    for (let i = 0; i < Math.min(n, parts.length); i++) parts[i]()
    return svg
  }

  /* --- 20 questions --- */
  twenty() {
    const g = this.game, log = g.state.log || [], thinker = g.p1 === this.me, last = log[log.length - 1]
    const open = last && !last.a
    const list = h('ol', { class: 'tq-log' }, log.map((e) => h('li', {}, h('span', { class: e.g ? 'tq-guess' : '' }, e.g ? `Guess: ${e.q}` : e.q), ' ', e.a ? h('b', { class: `tq-a ${e.a}` }, e.a) : h('i', { class: 'small' }, '…'))))
    let controls = null
    if (g.status === 'active' && this.mine) {
      if (thinker && open) controls = h('div', { class: 'g-row' }, last.g ? h('b', {}, `Is it "${last.q}"?`) : null, ['Yes', 'No', 'Sometimes'].map((a) => h('button', { class: 'btn small', type: 'button', onclick: () => this.send(twentyAnswer(g, this.me, a)) }, a)))
      else if (!thinker) {
        const input = h('input', { type: 'text', maxLength: 140, placeholder: 'Ask a yes/no question', 'aria-label': 'Your question', autocomplete: 'off' })
        const guess = h('input', { type: 'checkbox', id: 'tq-g' })
        controls = h('form', { class: 'g-form', onsubmit: (e) => { e.preventDefault(); this.send(twentyAsk(g, this.me, input.value, guess.checked)) } }, input,
          h('label', { class: 'small', for: 'tq-g' }, guess, ' This is my final guess'), h('button', { class: 'btn primary', type: 'submit' }, 'Ask'))
        setTimeout(() => input.focus(), 0)
      }
    }
    return h('div', {},
      h('p', { class: 'small' }, thinker ? `You are thinking of: ${this.secret || '…'}` : `Question ${Math.min(log.length + (open ? 0 : 1), TWENTY_MAX)} of ${TWENTY_MAX}`),
      g.status === 'done' ? h('p', {}, 'It was ', h('b', {}, this.secret || '…')) : null, list, controls)
  }
}

/* ---------------- solo game window ---------------- */
export function openSolo(game) {
  const box = h('div', { class: 'game solo' })
  let stop = null
  dialog({ title: game.title, body: box, wide: true, actions: [], onClose: () => stop?.() })
  stop = game.mount(box)
}

/* ---------------- games button + "game in progress" strip inside a chat ---------------- */
export class GamesController {
  constructor(ctx) {
    this.ctx = ctx; this.room = null; this.session = null; this.unlisten = null
    this.btn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Games', title: 'Games', onclick: () => this.hub() }, icon('game'))
    this.banner = h('div', { class: 'call-banner game-banner', hidden: true })
  }
  setRoom(r) {
    if (this.room?.id === r?.id) return
    this.unlisten?.(); this.unlisten = null; this.room = r; this.banner.hidden = true
    this.session?.dlg?.close()
    if (!this.canVersus) return
    this.unlisten = gameApi.listen(r.id, (row) => { this.session?.update(row); this.paint(row) })
    this.refresh()
  }
  get canVersus() { return !!this.room && this.room.is_direct && !this.room.notes_owner }
  peer() { return this.ctx.peerOf(this.room) }
  destroy() { this.unlisten?.(); this.session?.dlg?.close() }
  sessionClosed(s) { if (this.session === s) this.session = null; this.refresh() }
  async refresh() {
    if (!this.canVersus) return
    const id = this.room.id
    try { const g = await gameApi.latest(id); if (this.room?.id === id) this.paint(g) } catch { /* games are optional until update-v0.11.sql has been run */ }
  }
  paint(g) {
    if (!g || g.room_id !== this.room?.id || g.status !== 'active') { this.banner.hidden = true; return }
    const mine = g.turn === this.ctx.me.id
    clear(this.banner).append(h('span', { class: 'cb-text' }, icon('game', 16), ` ${VERSUS[g.kind].title} · ${mine ? 'your turn' : `waiting for ${this.ctx.nameOf(g.turn)}`}`),
      h('button', { class: 'btn primary small', type: 'button', onclick: () => this.openGame(g) }, mine ? 'Play' : 'Open'))
    this.banner.hidden = false
  }
  openGame(g) { this.session?.dlg?.close(); this.session = new GameSession(this.ctx, g).open() }
  async startGame(room, kind) {
    try {
      let secret = null
      if (VERSUS[kind].secret) { secret = await askSecret(VERSUS[kind]); if (secret == null) return }
      const id = await gameApi.start(room, kind, secret)
      this.openGame(await gameApi.get(id))
    } catch (e) { toast(friendlyError(e), 'error') }
  }
  hub() {
    const versus = this.canVersus
    const card = (title, blurb, fn) => h('button', { class: 'game-card', type: 'button', onclick: fn }, h('b', {}, title), h('span', { class: 'small' }, blurb))
    let d
    const body = h('div', { class: 'games-hub' },
      versus ? h('div', {}, h('h3', {}, `Play with ${this.ctx.nameOf(this.peer())}`),
        h('div', { class: 'game-grid' }, Object.entries(VERSUS).map(([k, v]) => card(v.title, v.blurb, () => { d.close(); this.startGame(this.room.id, k) }))))
        : h('p', { class: 'small' }, 'Two-player games are available in a chat between two people.'),
      h('h3', {}, 'Play alone'), h('div', { class: 'game-grid' }, SOLO.map((s) => card(s.title, s.blurb, () => { d.close(); openSolo(s) }))))
    d = dialog({ title: 'Games', body, wide: true, actions: [] })
  }
}

function askSecret(spec) {
  return new Promise((resolve) => {
    let done = false
    const input = h('input', { type: 'text', maxLength: 40, autocomplete: 'off', 'aria-label': 'Secret' })
    const submit = (close) => { const v = input.value.trim(); if (!v) { toast('Type something first', 'error'); return 'keep-open' } done = true; resolve(v) }
    dialog({ title: spec.title, body: h('div', {}, h('p', {}, spec.secret), input),
      actions: [{ label: 'Cancel', onClick: () => { done = true; resolve(null) } }, { label: 'Start', kind: 'primary', onClick: submit }],
      onClose: () => { if (!done) resolve(null) } })
    setTimeout(() => input.focus(), 0)
  })
}

// Solo games from the Tools tab
export function renderSoloList(box) {
  clear(box).append(h('p', { class: 'small' }, 'Play on your own. Your best scores are saved on this device only. To play against someone, open a chat with them and tap the controller button.'),
    h('div', { class: 'game-grid' }, SOLO.map((s) => h('button', { class: 'game-card', type: 'button', onclick: () => openSolo(s) }, h('b', {}, s.title), h('span', { class: 'small' }, s.blurb)))))
}
