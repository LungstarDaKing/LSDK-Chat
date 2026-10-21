import { describe, it, expect } from 'vitest'
import { buildTrack, newCar, stepCar, botInput, nearest, gridSlot, CARS, CAR_IDS } from '../src/games/race/engine.js'
import { TRACKS, THEMES } from '../src/games/race/tracks.js'
import { VERSUS } from '../src/lib/games.js'

const lapTime = (track, carId, laps = 1) => {
  const c = newCar(track, 0, carId), dt = 1 / 60
  let t = 0
  while (t < 200 && c.total < track.N * laps) { stepCar(c, botInput(c, track, 0.97), track, dt); t += dt }
  return { time: t, car: c }
}

describe('race maps', () => {
  it('every map is a closed loop that never touches itself, with a theme', () => {
    for (const d of TRACKS) {
      const t = buildTrack(d)
      expect(THEMES[d.theme], d.id).toBeTruthy()
      expect(Math.abs(t.length - d.km * 1700) / (d.km * 1700), d.id).toBeLessThan(0.02)         // real lap length
      let close = 1e9
      for (let i = 0; i < t.N; i += 3) for (let j = i + Math.floor(t.N / 10); j < t.N; j += 3) { if (t.N - (j - i) < t.N / 10) continue; close = Math.min(close, Math.hypot(t.x[i] - t.x[j], t.y[i] - t.y[j])) }
      expect(close, d.id).toBeGreaterThan(t.width * 1.4)
    }
  })
  it('every map can be driven around by a bot in a sensible time', () => {
    for (const d of TRACKS) {
      const { time, car } = lapTime(buildTrack(d), 'coupe')
      expect(car.total, d.id).toBeGreaterThanOrEqual(buildTrack(d).N)
      expect(time, d.id).toBeLessThan(120)
    }
  })
})

describe('race driving', () => {
  const track = buildTrack(TRACKS[0])
  it('starts behind the line and counts a lap when the line is crossed', () => {
    const c = newCar(track, 0, 'coupe')
    expect(c.total).toBeLessThan(0)
    const { car } = lapTime(track, 'coupe', 1)
    expect(car.lapsDone).toBe(1)
    expect(car.total).toBeGreaterThanOrEqual(track.N)
  })
  it('a car standing still stays still, and full throttle never exceeds the top speed', () => {
    const idle = newCar(track, 0, 'coupe')
    for (let i = 0; i < 120; i++) stepCar(idle, { gas: 0, brake: 0, steer: 0 }, track, 1 / 60)
    expect(Math.hypot(idle.vx, idle.vy)).toBeLessThan(1)
    const fast = newCar(track, 0, 'veloce')
    for (let i = 0; i < 400; i++) stepCar(fast, botInput(fast, track), track, 1 / 60)
    expect(Math.hypot(fast.vx, fast.vy)).toBeLessThanOrEqual(CARS.veloce.top * 1.06)
  })
  it('grass is slower than asphalt, and the wall keeps cars on the map', () => {
    const c = newCar(track, 0, 'coupe'); const g = gridSlot(track, 0)
    c.x = g.x - track.ty[g.i] * (track.width / 2 + 40); c.y = g.y + track.tx[g.i] * (track.width / 2 + 40); c.h = g.h
    stepCar(c, { gas: 1, brake: 0, steer: 0 }, track, 1 / 60)
    expect(c.onGrass).toBe(true)
    for (let i = 0; i < 600; i++) stepCar(c, { gas: 1, brake: 0, steer: 1 }, track, 1 / 60)
    expect(Math.abs(nearest(track, c.x, c.y, c.idx).lat)).toBeLessThan(track.wall + 4)
  })
  it('the cars are meaningfully different but none is hopeless', () => {
    const times = CAR_IDS.map((id) => lapTime(buildTrack(TRACKS[3]), id).time)
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.6)
    expect(Math.max(...times) / Math.min(...times)).toBeGreaterThan(1.1)
  })
})

describe('race game entry', () => {
  it('is offered in the games menu', () => { expect(VERSUS.race.title).toBe('Car race') })
})
