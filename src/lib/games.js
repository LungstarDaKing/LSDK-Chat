// Two-player games inside a direct chat. The database (supabase/update-v0.10.sql) keeps the shared
// state, decides whose turn it is and hides the hangman / 20-questions secret until the end.
import { supabase } from './supabase.js'

export const VERSUS = {
  ttt: { title: 'Tic-tac-toe', blurb: 'Three in a row. Quick one.', secret: null },
  chess: { title: 'Chess', blurb: 'Full rules. The one who starts plays white.', secret: null },
  hangman: { title: 'Hangman', blurb: 'You pick a word, they guess it letter by letter.', secret: 'Type a word for them to guess (3 to 20 letters)' },
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
