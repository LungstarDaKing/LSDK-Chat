// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/lib/supabase.js', () => ({ supabase: {}, appUrl: () => '' }))
vi.mock('../src/lib/ringtones.js', () => ({ startRingtone: vi.fn(), stopRingtone: vi.fn() }))
const { GroupCallOverlay } = await import('../src/ui/group-call-ui.js')
const { h } = await import('../src/lib/dom.js')

const people = new Map([['me', { username: 'alice' }], ['u2', { username: 'bob<b>' }], ['u3', { username: 'cy' }]])
const ctx = {
  me: { id: 'me' }, people, room: () => ({ name: 'Team <i>x</i>' }), nameOf: (id) => people.get(id)?.username || 'Former member',
  avatar: (id) => h('span', { class: 'avatar xl' }, '?'), hydrateAvatars() {}, ensurePeople: async () => {},
}
const mgr = { decline: vi.fn(), accept: vi.fn(), hangup: vi.fn(), toggleMute: vi.fn(), toggleCamera: vi.fn(), retryPeer: vi.fn() }
const base = { phase: 'active', kind: 'video', roomId: 'r1', starterId: 'me', startedAt: Date.now(), local: null, muted: false, camOff: false, peers: {}, members: [] }

describe('group call screen', () => {
  it('shows an incoming ring with accept / decline and no markup injection', () => {
    const o = new GroupCallOverlay(ctx, mgr)
    o.update({ ...base, phase: 'incoming', starterId: 'u2', members: [] })
    expect(document.querySelector('.gc-overlay').textContent).toContain('bob<b>')
    expect(document.querySelector('.gc-overlay i')).toBeNull()
    const btns = [...document.querySelectorAll('.call-btn')]
    expect(btns.map((b) => b.getAttribute('aria-label'))).toEqual(['Decline', 'Join call'])
    btns[1].click(); expect(mgr.accept).toHaveBeenCalled()
    o.update({ ...base, phase: 'idle' }); expect(document.querySelector('.gc-overlay')).toBeNull()
  })
  it('draws one tile per person with the right status and controls', () => {
    const o = new GroupCallOverlay(ctx, mgr)
    o.update({ ...base, members: [
      { profile_id: 'me', state: 'joined' }, { profile_id: 'u2', state: 'joined' }, { profile_id: 'u3', state: 'ringing' }, { profile_id: 'u4', state: 'declined' }],
      peers: { u2: { state: 'failed', stream: null } } })
    const tiles = [...document.querySelectorAll('.gc-tile')]
    expect(tiles.length).toBe(3)
    expect(document.querySelector('.gc-grid').dataset.n).toBe('3')
    expect(tiles[2].textContent).toContain('Ringing')
    expect(tiles[1].textContent).toContain('Could not connect')
    expect(tiles[1].querySelector('.gc-retry').hidden).toBe(false)
    expect(document.querySelectorAll('.call-btn').length).toBe(3)            // mute, camera, leave
    document.querySelector('.call-btn.hang').click(); expect(mgr.hangup).toHaveBeenCalled()
    // someone leaves: their tile disappears
    o.update({ ...base, members: [{ profile_id: 'me', state: 'joined' }, { profile_id: 'u2', state: 'left' }], peers: {} })
    expect(document.querySelectorAll('.gc-tile').length).toBe(1)
    o.update({ ...base, phase: 'idle' })
  })
})
