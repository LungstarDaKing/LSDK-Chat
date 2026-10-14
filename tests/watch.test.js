import { describe, it, expect } from 'vitest'
import { parseMediaLink, embedUrl, validMedia, expectedPos, matchAction, localChange } from '../src/lib/watch.js'

describe('watch links', () => {
  it('understands the YouTube link shapes', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=5', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ'])
      expect(parseMediaLink(u)).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })
  it('understands Spotify, Apple Music and TikTok', () => {
    expect(parseMediaLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc')).toEqual({ provider: 'spotify', id: 'track/4uLU6hMCjMI75M1A2tKUQC' })
    expect(parseMediaLink('https://open.spotify.com/intl-za/album/1DFixLWuPkv3KT3TnV35m3')).toEqual({ provider: 'spotify', id: 'album/1DFixLWuPkv3KT3TnV35m3' })
    expect(parseMediaLink('https://music.apple.com/za/album/some-album/1234567890?i=1234567891')).toEqual({ provider: 'apple', id: '/za/album/some-album/1234567890?i=1234567891' })
    expect(parseMediaLink('https://www.tiktok.com/@user/video/7234567890123456789')).toEqual({ provider: 'tiktok', id: '7234567890123456789' })
  })
  it('refuses everything else and says why', () => {
    expect(parseMediaLink('not a link').error).toMatch(/full link/)
    expect(parseMediaLink('https://evil.example/watch?v=dQw4w9WgXcQ').error).toMatch(/not supported/)
    expect(parseMediaLink('https://vm.tiktok.com/ZMabc123/').error).toMatch(/short links/)
    expect(parseMediaLink('javascript:alert(1)').error).toBeTruthy()
    expect(parseMediaLink('https://www.youtube.com/watch?v=short').error).toBeTruthy()
  })
  it('builds frame addresses only from checked ids', () => {
    expect(embedUrl('youtube', 'dQw4w9WgXcQ', { origin: 'https://x.github.io' })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&playsinline=1&rel=0&origin=https%3A%2F%2Fx.github.io')
    expect(embedUrl('youtube', '"><script>', {})).toBe(null)
    expect(embedUrl('spotify', 'track/4uLU6hMCjMI75M1A2tKUQC')).toBe('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC')
    expect(embedUrl('apple', '/za/album/a/1234567890?i=1234567891')).toBe('https://embed.music.apple.com/za/album/a/1234567890?i=1234567891')
    expect(embedUrl('tiktok', '7234567890123456789')).toBe('https://www.tiktok.com/embed/v2/7234567890123456789')
    expect(validMedia('apple', '/za/album/../../x')).toBe(false)
  })
})

describe('keeping players in step', () => {
  const row = (o) => ({ playing: true, pos: 100, ...o })
  it('works out where the shared video should be', () => {
    expect(expectedPos(row(), 1000, 4000)).toBe(103)
    expect(expectedPos(row({ playing: false }), 1000, 4000)).toBe(100)
  })
  it('tells a player how to match the shared state', () => {
    expect(matchAction(row(), 0, { playing: false, pos: 100 }, 0)).toBe('play')
    expect(matchAction(row(), 0, { playing: false, pos: 50 }, 0)).toBe('seek-play')
    expect(matchAction(row({ playing: false }), 0, { playing: true, pos: 100 }, 0)).toBe('pause')
    expect(matchAction(row(), 0, { playing: true, pos: 101 }, 0)).toBe('none')       // small drift is ignored
    expect(matchAction(row(), 0, { playing: true, pos: 140 }, 0)).toBe('seek')
  })
  it('notices when the person in control uses the player buttons', () => {
    expect(localChange(row(), 0, { playing: false, pos: 100 }, 0)).toEqual({ action: 'pause', pos: 100 })
    expect(localChange(row(), 0, { playing: true, pos: 220 }, 0)).toEqual({ action: 'seek', pos: 220 })
    expect(localChange(row(), 0, { playing: true, pos: 101 }, 0)).toBe(null)
  })
})
