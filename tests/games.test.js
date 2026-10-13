import { describe, it, expect } from 'vitest'
import { tttWinner, tttPlay, twentyAsk, twentyAnswer, TWENTY_MAX } from '../src/lib/games.js'
import { scramble, sameWord, songRound, SONGS, WORDS, newStickman, stickmanStep } from '../src/games/solo.js'

const A = 'a', B = 'b'
const game = (over = {}) => ({ id: 'g', kind: 'ttt', p1: A, p2: B, status: 'active', turn: A, version: 0, state: { board: Array(9).fill(null) }, ...over })

describe('tic-tac-toe', () => {
  it('finds rows, columns and diagonals', () => {
    expect(tttWinner(['X', 'X', 'X', null, null, null, null, null, null]).line).toEqual([0, 1, 2])
    expect(tttWinner(['O', null, null, 'O', null, null, 'O', null, null]).mark).toBe('O')
    expect(tttWinner(['X', 'O', null, null, 'X', null, null, null, 'X']).line).toEqual([0, 4, 8])
    expect(tttWinner(Array(9).fill(null))).toBe(null)
  })
  it('only lets the player whose turn it is play an empty square', () => {
    expect(tttPlay(game(), 0, B)).toBe(null)
    const r = tttPlay(game(), 4, A)
    expect(r.state.board[4]).toBe('X'); expect(r.status).toBe('active')
    expect(tttPlay(game({ state: r.state, turn: B }), 4, B)).toBe(null)
    expect(tttPlay(game({ status: 'done' }), 0, A)).toBe(null)
  })
  it('ends on a win and on a draw', () => {
    const win = tttPlay(game({ state: { board: ['X', 'X', null, 'O', 'O', null, null, null, null] } }), 2, A)
    expect(win).toMatchObject({ status: 'done', winner: A })
    const draw = tttPlay(game({ state: { board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', null] } }), 8, A)
    expect(draw).toMatchObject({ status: 'done', winner: null, result: 'Draw' })
  })
})

describe('20 questions', () => {
  const tq = (log = [], turn = B) => game({ kind: 'twenty', turn, state: { log, asked: log.length } })
  it('asker asks, thinker answers, guess ends the game', () => {
    expect(twentyAsk(tq([], A), A, 'Is it big?', false)).toBe(null)          // thinker cannot ask
    const asked = twentyAsk(tq(), B, 'Is it an animal?', false)
    expect(asked.state.log).toEqual([{ q: 'Is it an animal?', g: false }])
    const ans = twentyAnswer(tq(asked.state.log, A), A, 'Yes')
    expect(ans.status).toBe('active')
    const guess = twentyAsk(tq(ans.state.log), B, 'giraffe', true)
    expect(twentyAnswer(tq(guess.state.log, A), A, 'Yes')).toMatchObject({ status: 'done', winner: B })
    expect(twentyAnswer(tq(guess.state.log, A), A, 'No').status).toBe('active')
  })
  it('thinker wins when the questions run out', () => {
    const log = Array.from({ length: TWENTY_MAX }, (_, i) => ({ q: 'q' + i, g: false, a: i === TWENTY_MAX - 1 ? undefined : 'No' }))
    expect(twentyAnswer(tq(log, A), A, 'No')).toMatchObject({ status: 'done', winner: A })
    expect(twentyAnswer(tq(log, A), A, 'Maybe')).toBe(null)
  })
})

describe('solo games', () => {
  it('scrambles into a different arrangement of the same letters', () => {
    for (const [w] of WORDS) { const s = scramble(w); expect(s).not.toBe(w); expect(s.split('').sort().join('')).toBe(w.split('').sort().join('')) }
    expect(sameWord(' ubuntu ', 'UBUNTU')).toBe(true)
  })
  it('emoji rounds contain the answer once and four options', () => {
    for (let i = 0; i < 50; i++) { const r = songRound(); expect(r.options).toHaveLength(4); expect(new Set(r.options).size).toBe(4); expect(r.options).toContain(r.answer) }
    expect(new Set(SONGS.map((s) => s[1])).size).toBe(SONGS.length)
  })
  it('stickman jumps, scores and dies when it hits a block', () => {
    const st = newStickman(() => .5); st.jumpReq = true
    stickmanStep(st, .016); expect(st.y).toBeGreaterThan(0)
    for (let i = 0; i < 100; i++) stickmanStep(st, .016); expect(st.y).toBe(0)
    const dead = newStickman(() => .5); dead.obs.push({ x: 55, w: 20, h: 40 }); stickmanStep(dead, .001); expect(dead.dead).toBe(true)
    const safe = newStickman(() => .5); safe.obs.push({ x: 55, w: 20, h: 40 }); safe.y = 60; safe.jumpReq = false; stickmanStep(safe, .001); expect(safe.dead).toBe(false)
  })
})
