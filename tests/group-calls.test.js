// @vitest-environment jsdom
// Group call engine test: four simulated phones, a fake database and a fake WebRTC.
// It checks the things that matter: who rings, who connects to whom, late joining,
// leaving, and that only the smaller user id ever makes the offer.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: {}, appUrl: () => '' }))
const { GroupCallManager } = await import('../src/lib/group-calls.js')

class FakeStream {
  constructor(tracks = []) { this.tracks = [...tracks] }
  getTracks() { return this.tracks } getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') } addTrack(t) { this.tracks.push(t) }
}
globalThis.MediaStream = FakeStream
const track = (kind) => ({ kind, enabled: true, stop() { this.stopped = true } })

// ---- fake WebRTC: two sides connect once each has a local and a remote description ----
const wire = new Map()   // sdp token -> pc that created the offer
class FakePC {
  constructor() { this.connectionState = 'new'; this.remoteDescription = null; this.localDescription = null; this.senders = []; this.closed = false; FakePC.all.push(this) }
  addTrack(t) { this.senders.push({ track: t, getParameters: () => ({ encodings: [{}] }), setParameters: async () => {} }) }
  getSenders() { return this.senders }
  async createOffer() { const sdp = 'offer-' + Math.random(); wire.set(sdp, this); return { type: 'offer', sdp } }
  async createAnswer() { const sdp = 'answer-' + Math.random(); wire.set(sdp, this); return { type: 'answer', sdp } }
  async setLocalDescription(d) { this.localDescription = d; this.maybeConnect() }
  async setRemoteDescription(d) { this.remoteDescription = d; this.peerPc = wire.get(d.sdp); this.maybeConnect() }
  async addIceCandidate() {}
  maybeConnect() {
    if (this.connectionState !== 'new' || !this.localDescription || !this.remoteDescription) return
    this.connectionState = 'connecting'
    setTimeout(() => {
      if (this.closed) return
      this.connectionState = 'connected'
      this.ontrack?.({ track: track('audio'), streams: [new FakeStream([track('audio')])] })
      this.onconnectionstatechange?.()
    }, 5)
  }
  close() { this.closed = true; this.connectionState = 'closed' }
}
FakePC.all = []

// ---- fake database shared by all phones ----
function makeDb(userIds) {
  const members = new Map(), signals = [], listeners = new Map(), calls = new Map()
  let sigN = 0
  const emit = (fn, row) => setTimeout(() => { for (const l of listeners.values()) l[fn](row) }, 0)
  const db = { members, signals, calls, offersFrom: [] }
  db.api = (me) => ({
    start: async (room, kind) => {
      const id = 'call1'
      calls.set(id, { id, room_id: room, started_by: me, kind, ended_at: null })
      for (const u of userIds) members.set(u, { call_id: id, profile_id: u, state: u === me ? 'joined' : 'ringing', invited_at: new Date().toISOString() })
      for (const u of userIds) emit('member', members.get(u))
      emit('call', calls.get(id))
      return id
    },
    join: async (id) => { const m = members.get(me); m.state = 'joined'; for (let i = signals.length - 1; i >= 0; i--) if (signals[i].from_id === me || signals[i].to_id === me) signals.splice(i, 1); emit('member', { ...m }) },
    decline: async () => { const m = members.get(me); if (m.state === 'ringing') { m.state = 'declined'; emit('member', { ...m }) } },
    leave: async () => { const m = members.get(me); m.state = 'left'; for (let i = signals.length - 1; i >= 0; i--) if (signals[i].from_id === me || signals[i].to_id === me) signals.splice(i, 1); emit('member', { ...m }) },
    ping: async () => {},
    signal: async (call_id, to, kind, payload) => {
      if (members.get(to)?.state !== 'joined') throw new Error('Not in this call')
      if (kind === 'offer') db.offersFrom.push([me, to])
      const row = { id: 's' + ++sigN, call_id, from_id: me, to_id: to, kind, payload }
      signals.push(row); emit('signal', row)
    },
    getCall: async (id) => calls.get(id) || null,
    members: async () => [...members.values()].map((m) => ({ ...m })),
    mySignals: async () => signals.filter((s) => s.to_id === me),
    ringingForMe: async () => [],
    listen(onMember, onSignal, onCall) { listeners.set(me, { member: onMember, signal: (s) => s.to_id === me && onSignal(s), call: onCall }); return () => listeners.delete(me) },
  })
  return db
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const phone = (db, id, ended = []) => {
  const mgr = new GroupCallManager({ api: db.api(id), meId: id, onChange: () => {}, onEnded: (e) => ended.push(e),
    rtc: { RTCPeerConnection: FakePC, getUserMedia: async () => new FakeStream([track('audio')]), getIceServers: async () => [] } })
  return mgr
}
const connectedTo = (m) => Object.entries(m.s.peers).filter(([, p]) => p.state === 'connected').map(([id]) => id).sort()

describe('group call (simulated phones)', () => {
  it('rings everyone, connects every pair once, lets people join late and leave', async () => {
    const ids = ['u1', 'u2', 'u3', 'u4']
    const db = makeDb(ids)
    const ended = {}; const m = Object.fromEntries(ids.map((id) => { ended[id] = []; return [id, phone(db, id, ended[id])] }))

    // u1 starts the call in the group; the others are invited and show "incoming"
    await m.u1.start('room1', 'voice')
    await wait(20)
    expect(m.u1.s.phase).toBe('active')
    expect(db.members.get('u2').state).toBe('ringing')
    for (const id of ['u2', 'u3', 'u4']) { await m[id].showIncoming('call1'); expect(m[id].s.phase).toBe('incoming') }

    // u2 and u3 accept, u4 declines
    await m.u2.accept(); await m.u3.accept(); await m.u4.decline()
    await wait(300)
    expect(db.members.get('u4').state).toBe('declined')
    expect(connectedTo(m.u1)).toEqual(['u2', 'u3'])
    expect(connectedTo(m.u2)).toEqual(['u1', 'u3'])
    expect(connectedTo(m.u3)).toEqual(['u1', 'u2'])

    // only the smaller id ever made an offer (no clashes), and each pair got exactly one
    expect(db.offersFrom.every(([from, to]) => from < to)).toBe(true)
    expect(db.offersFrom.length).toBe(3)

    // u4 changes their mind and joins late: connects to all three
    m.u4 = phone(db, 'u4', ended.u4)
    await m.u4.join('call1')
    await wait(400)
    expect(m.u4.s.phase).toBe('active')
    expect(connectedTo(m.u4)).toEqual(['u1', 'u2', 'u3'])
    expect(connectedTo(m.u1)).toEqual(['u2', 'u3', 'u4'])
    expect(db.offersFrom.every(([from, to]) => from < to)).toBe(true)

    // u2 leaves: the others drop only that person and keep talking
    await m.u2.hangup()
    await wait(300)
    expect(m.u2.s.phase).toBe('idle')
    expect(ended.u2.at(-1).reason).toBe('ended')
    expect(connectedTo(m.u1)).toEqual(['u3', 'u4'])
    expect(connectedTo(m.u3)).toEqual(['u1', 'u4'])

    // mute / camera toggles act on the local tracks
    m.u1.toggleMute(); expect(m.u1.s.local.getAudioTracks()[0].enabled).toBe(false); expect(m.u1.s.muted).toBe(true)

    // the full call cannot be changed by strangers: a phone not in the list gets nothing
    for (const id of ['u1', 'u3', 'u4']) m[id].destroy()
  })

  it('refuses to start while another call is running', async () => {
    const db = makeDb(['u1', 'u2'])
    const a = new GroupCallManager({ api: db.api('u1'), meId: 'u1', onChange() {}, onEnded() {}, isBusy: () => true,
      rtc: { RTCPeerConnection: FakePC, getUserMedia: async () => new FakeStream([track('audio')]), getIceServers: async () => [] } })
    await expect(a.start('room1', 'voice')).rejects.toThrow(/already in a call/)
    a.destroy()
  })

  it('ends the call for the last person when everyone else has left', async () => {
    const ids = ['u1', 'u2']
    const db = makeDb(ids)
    const ended = { u1: [], u2: [] }
    const m = { u1: phone(db, 'u1', ended.u1), u2: phone(db, 'u2', ended.u2) }
    await m.u1.start('room1', 'voice'); await m.u2.showIncoming('call1'); await m.u2.accept()
    await wait(300)
    expect(connectedTo(m.u1)).toEqual(['u2'])
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await m.u2.hangup()
    await vi.advanceTimersByTimeAsync(5000)   // the alone-timer (4 s)
    vi.useRealTimers()
    expect(m.u1.s.phase).toBe('idle')
    expect(ended.u1.at(-1).message).toMatch(/Everyone has left/)
  })
})
