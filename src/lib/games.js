// Two-player games inside a direct chat. The database (supabase/update-v0.10.sql) keeps the shared
// state, decides whose turn it is and hides the hangman / 20-questions secret until the end.
import { supabase } from './supabase.js'

export const VERSUS = {
  ttt: { title: 'Tic-tac-toe', blurb: 'Three in a row. Quick one.', secret: null },
  chess: { title: 'Chess', blurb: 'Full rules. The one who starts plays white.', secret: null },
  hangman: { title: 'Hangman', blurb: 'You pick a word, they guess it letter by letter.', secret: 'Type a word for them to guess (3 to 20 letters)' },
  darts: { title: 'Darts', blurb: '301, first to exactly zero. Three darts a turn.', secret: null },
  twenty: { title: '20 Questions', blurb: 'You think of something. They have 20 yes/no questions.', secret: 'Think of a person, place or thing and type it. Only you can see it.' },
}

const ok = ({ data, error }) => { if (error) throw error; return data }
export const gameApi = {
  start: async (room, kind, secret = null) => ok(await supabase.rpc('game_start', { p_room: room, p_kind: kind, p_secret: secret })),
  move: async (id, version, state, status = 'active', winner = null, result = null) =>
    ok(await supabase.rpc('game_move', { p_game: id, p_version: version, p_state: state, p_status: status, p_winner: winner, p_result: result })),
  guess: async (id, letter) => ok(await supabase.rpc('game_guess', { p_game: id, p_letter: letter })),
  resign: async (id) => ok(await supabase.rpc('game_resign', { p_game: id })),
  secret: async (id) => ok(await supabase.rpc('game_secret', { p_game: id })),
  get: async (id) => ok(await supabase.from('games').select('*').eq('id', id).maybeSingle()),
  latest: async (room) => ok(await supabase.from('games').select('*').eq('room_id', room).order('created_at', { ascending: false }).limit(1).maybeSingle()),
  listen(room, onRow) {
    const ch = supabase.channel(`games-${room}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `room_id=eq.${room}` }, (p) => p.new && onRow(p.new))
      .subscribe()
    return () => supabase.removeChannel(ch)
  },
}

/* ---------- tic-tac-toe ---------- */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
export function tttWinner(board) {
  for (const [a, b, c] of LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line: [a, b, c] }
  return null
}
// The starter (p1) is X. Returns what to send to the database, or null if the move is not allowed.
export function tttPlay(game, idx, me) {
  const board = [...(game.state.board || [])]
  if (game.status !== 'active' || game.turn !== me || board[idx]) return null
  const mark = me === game.p1 ? 'X' : 'O'
  board[idx] = mark
  const w = tttWinner(board)
  if (w) return { state: { board }, status: 'done', winner: me, result: 'Three in a row' }
  if (board.every(Boolean)) return { state: { board }, status: 'done', winner: null, result: 'Draw' }
  return { state: { board }, status: 'active', winner: null, result: null }
}

/* ---------- 20 questions ---------- */
export const TWENTY_MAX = 20
// asker (p2) sends a question; isGuess marks "Is it ...?" as the final guess for that round
export function twentyAsk(game, me, text, isGuess) {
  const q = String(text || '').trim().slice(0, 140)
  if (!q || game.status !== 'active' || game.turn !== me || me === game.p1) return null
  const log = [...(game.state.log || []), { q, g: !!isGuess }]
  return { state: { log, asked: log.length }, status: 'active', winner: null, result: null }
}
// thinker (p1) answers the open question
export function twentyAnswer(game, me, answer) {
  if (game.status !== 'active' || game.turn !== me || me !== game.p1) return null
  if (!['Yes', 'No', 'Sometimes'].includes(answer)) return null
  const log = [...game.state.log]; const last = log[log.length - 1]
  if (!last || last.a) return null
  log[last ? log.length - 1 : 0] = { ...last, a: answer }
  const state = { log, asked: log.length }
  if (last.g && answer === 'Yes') return { state, status: 'done', winner: game.p2, result: 'Guessed it' }
  if (log.length >= TWENTY_MAX) return { state, status: 'done', winner: game.p1, result: 'Out of questions' }
  return { state, status: 'active', winner: null, result: null }
}

/* ---------- display helpers ---------- */
export const maskLetters = (mask) => String(mask || '').split('')
export function resultLine(game, me, nameOf) {
  if (game.status !== 'done') return ''
  const how = game.result ? ` (${game.result})` : ''
  if (!game.winner) return `Draw${how}`
  return game.winner === me ? `You won${how}` : `${nameOf(game.winner)} won${how}`
}

/* ---------- darts (301, straight out: finish on exactly zero, going past zero is a bust) ---------- */
export const DART_START = 301
const BOARD = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]   // clockwise from the top
export const BOARD_ORDER = BOARD
// x, y are positions on the board in "board radius" units (0,0 is the middle, y grows downwards, 1 is the outer edge of the doubles)
export function dartScore(x, y) {
  const r = Math.hypot(x, y)
  if (r <= 0.037) return { pts: 50, label: 'Bullseye', mult: 2, seg: 25 }
  if (r <= 0.094) return { pts: 25, label: '25', mult: 1, seg: 25 }
  if (r > 1) return { pts: 0, label: 'Miss', mult: 0, seg: 0 }
  let ang = Math.atan2(x, -y) * 180 / Math.PI            // 0 = straight up, clockwise
  if (ang < 0) ang += 360
  const seg = BOARD[Math.floor(((ang + 9) % 360) / 18)]
  const mult = r >= 0.953 ? 2 : (r >= 0.582 && r <= 0.629) ? 3 : 1
  return { pts: seg * mult, label: mult === 3 ? `T${seg}` : mult === 2 ? `D${seg}` : String(seg), mult, seg }
}
// darts = up to three { pts, label }. Returns what to send, or null if it is not allowed.
export function dartsPlay(game, me, darts) {
  if (game.status !== 'active' || game.turn !== me || !Array.isArray(darts) || darts.length < 1 || darts.length > 3) return null
  const first = me === game.p1
  const before = first ? game.state.s1 : game.state.s2
  let left = before, bust = false, thrown = 0
  for (const d of darts) {
    thrown++
    if (left - d.pts < 0) { bust = true; break }
    left -= d.pts
    if (left === 0) break
  }
  if (!bust && left !== 0 && darts.length < 3) return null            // a turn is three darts unless you finish or bust
  const after = bust ? before : left
  const total = darts.slice(0, thrown).reduce((a, d) => a + d.pts, 0)
  const turn = { by: first ? 1 : 2, darts: darts.slice(0, thrown).map((d) => d.label), total: bust ? 0 : total, bust }
  const state = { s1: first ? after : game.state.s1, s2: first ? game.state.s2 : after, turns: [...(game.state.turns || []), turn].slice(-16) }
  if (after === 0) return { state, status: 'done', winner: me, result: `Checked out in round ${Math.ceil(state.turns.length / 2)}` }
  return { state, status: 'active', winner: null, result: null }
}
