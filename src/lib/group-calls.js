// Group voice / video calls (up to 6 people), directly between the phones (WebRTC "mesh").
//
// How it fits together
//   * Database (supabase/update-v0.8.sql): who is invited, who has joined, and the short
//     connection set-up messages ("signals"). Audio and video never pass through it.
//   * Every pair of people has ONE connection. To avoid both sides starting it at the same
//     moment, the person with the smaller user id always sends the offer.
//   * Each connection has a random "session id", so leftovers from an old attempt (someone
//     left and came back, or a retry) can never confuse a new one.
//   * Networks that block direct connections use the TURN relay (see CONFIG.turnUrl).
import { supabase } from './supabase.js'
import { CONFIG } from '../config.js'
import { iceServers as baseIceServers } from './calls.js'

export const MAX_GROUP = 6
const RING_MS = 60000
const PING_MS = 15000
const POLL_MS = 6000
const CONNECT_MS = 25000
const MAX_RETRIES = 3

/* ---------- relay (TURN) credentials ---------- */
let iceCache = null
export async function loadIceServers() {
  const base = baseIceServers()
  if (!CONFIG.turnUrl) return base
  if (iceCache && Date.now() - iceCache.at < 20 * 3600 * 1000) return iceCache.servers
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    const res = await fetch(CONFIG.turnUrl, { signal: ctl.signal })
    clearTimeout(t)
    const d = await res.json()
    const extra = [].concat(d?.iceServers || []).filter((s) => s && s.urls)
    if (extra.length) { iceCache = { at: Date.now(), servers: [...base, ...extra] }; return iceCache.servers }
  } catch { /* relay is optional: fall back to the normal servers */ }
  return base
}

/* ---------- database access ---------- */
const need = (r) => { if (r.error) throw r.error; return r.data }
export function supabaseGroupApi(meId) {
  return {
    start: async (room, kind) => need(await supabase.rpc('start_group_call', { p_room: room, p_kind: kind })),
    join: async (id) => need(await supabase.rpc('join_group_call', { p_call: id })),
    decline: async (id) => { await supabase.rpc('decline_group_call', { p_call: id }) },
    leave: async (id) => { await supabase.rpc('leave_group_call', { p_call: id }) },
    ping: async (id) => need(await supabase.rpc('group_call_ping', { p_call: id })),
    signal: async (id, to, kind, payload) => need(await supabase.rpc('send_group_signal', { p_call: id, p_to: to, p_kind: kind, p_payload: payload })),
    getCall: async (id) => (await supabase.from('group_calls').select('*').eq('id', id).maybeSingle()).data,
    members: async (id) => (await supabase.from('group_call_members').select('profile_id, state, invited_at, joined_at').eq('call_id', id)).data || [],
    mySignals: async (id) => (await supabase.from('group_call_signals').select('*').eq('call_id', id).eq('to_id', meId).order('created_at', { ascending: true })).data || [],
    ringingForMe: async () => {
      const { data } = await supabase.from('group_call_members').select('call_id, state, invited_at')
        .eq('profile_id', meId).eq('state', 'ringing').gt('invited_at', new Date(Date.now() - RING_MS).toISOString())
      return data || []
    },
    activeForRoom: async (roomId) => {
      const { data } = await supabase.from('group_calls').select('*').eq('room_id', roomId).is('ended_at', null)
        .gt('created_at', new Date(Date.now() - 8 * 3600 * 1000).toISOString()).order('created_at', { ascending: false }).limit(1)
      return data?.[0] || null
    },
    listen(onMember, onSignal, onCall) {
      const ch = supabase.channel('group-calls-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_call_members' }, (p) => p.new && onMember(p.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_calls' }, (p) => p.new && onCall(p.new))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_call_signals' }, (p) => p.new && onSignal(p.new))
        .subscribe()
      return () => supabase.removeChannel(ch)
    },
  }
}

export async function loadGroupCallLog(limit = 50) {
  const { data, error } = await supabase.from('group_call_members')
    .select('call_id, state, joined_at, left_at, invited_at, group_calls(id, room_id, kind, started_by, created_at, ended_at, rooms(name))')
    .eq('hidden', false).order('invited_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data || []).filter((r) => r.group_calls)
}
export const clearGroupCallLog = () => supabase.rpc('hide_group_call_history')

const rnd = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const mediaError = (e) => new Error(e?.name === 'NotAllowedError' ? 'Microphone/camera access was blocked. Allow it in your browser\'s address bar and try again.'
  : e?.name === 'NotFoundError' ? 'No microphone or camera was found.' : 'Could not start the microphone/camera.')

// phases: idle | incoming | joining | active
export class GroupCallManager {
  constructor({ api, meId, onChange, onEnded, onFeed, isBusy, rtc = {} }) {
    this.api = api; this.meId = meId; this.onChange = onChange; this.onEnded = onEnded; this.onFeed = onFeed
    this.isBusy = isBusy || (() => false)
    this.PC = rtc.RTCPeerConnection || window.RTCPeerConnection
    this.getMedia = rtc.getUserMedia || ((c) => navigator.mediaDevices.getUserMedia(c))
    this.getIce = rtc.getIceServers || loadIceServers
    this.s = this.blank()
    this.rec = new Map()
    this.buffer = []; this.seen = new Set()
    this.entered = false
    this.unlisten = api.listen((m) => this.onMemberRow(m), (sig) => this.onSignal(sig), (c) => this.onCallRow(c))
    this.poll = setInterval(() => this.tick(), POLL_MS)
    this.onVis = () => { if (document.visibilityState === 'visible' && this.entered) this.ping() }
    document.addEventListener('visibilitychange', this.onVis)
  }
  blank() { return { phase: 'idle', call: null, kind: null, roomId: null, starterId: null, members: [], peers: {}, local: null, muted: false, camOff: false, error: null, startedAt: null } }
  set(patch) { this.s = { ...this.s, ...patch }; this.onChange?.(this.s) }
  busy() { return this.s.phase !== 'idle' }
  destroy() { clearInterval(this.poll); document.removeEventListener('visibilitychange', this.onVis); this.unlisten?.(); this.teardown() }

  /* ----- starting / joining ----- */
  guard() {
    if (this.s.phase !== 'idle') throw new Error('You are already in a call.')
    if (this.isBusy()) throw new Error('You are already in a call.')
  }
  async media(kind) {
    try {
      return await this.getMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: kind === 'video' ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 }, facingMode: 'user' } : false,
      })
    } catch (e) { throw mediaError(e) }
  }

  async start(roomId, kind) {
    this.guard()
    this.set({ ...this.blank(), phase: 'joining', kind, roomId })
    try {
      const local = await this.media(kind)
      this.set({ local })
      const id = await this.api.start(roomId, kind)      // returns the call already running here, if any
      await this.enter(id, local, kind)
    } catch (e) { this.abort(e.message || 'Could not start the call.') }
  }

  // join a call that is already running (banner "Join", or after a missed ring)
  async join(callId) {
    this.guard()
    this.set({ ...this.blank(), phase: 'joining' })
    try {
      const call = await this.api.getCall(callId)
      if (!call || call.ended_at) throw new Error('This call has ended.')
      this.set({ kind: call.kind, roomId: call.room_id, call })
      const local = await this.media(call.kind)
      this.set({ local })
      await this.enter(callId, local, call.kind)
    } catch (e) { this.abort(e.message || 'Could not join the call.') }
  }

  async accept() {
    const call = this.s.call
    if (this.s.phase !== 'incoming' || !call) return
    clearTimeout(this.ringTimer)
    this.set({ phase: 'joining' })
    try {
      const local = await this.media(call.kind)
      this.set({ local })
      await this.enter(call.id, local, call.kind)
    } catch (e) { await this.api.decline(call.id).catch(() => {}); this.abort(e.message || 'Could not join the call.') }
  }
  async decline() {
    const call = this.s.call
    clearTimeout(this.ringTimer)
    if (call) await this.api.decline(call.id).catch(() => {})
    this.teardown(); this.finish('declined')
  }

  async enter(id, local, wantedKind) {
    await this.api.join(id)
    const call = await this.api.getCall(id)
    if (!call) throw new Error('This call is no longer available.')
    // joined a call of a different type than the button pressed (e.g. video into a voice call)
    if (call.kind !== wantedKind) {
      local.getTracks().forEach((t) => t.stop())
      local = await this.media(call.kind)
    }
    this.ice = await this.getIce()
    const members = await this.api.members(id)
    this.sid = rnd()
    this.entered = true
    this.set({ phase: 'active', call, kind: call.kind, roomId: call.room_id, starterId: call.started_by, members, local, startedAt: Date.now() })
    this.hb = setInterval(() => this.ping(), PING_MS)
    this.reconcile(members)
    const early = this.buffer.filter((b) => b.call_id === id); this.buffer = []
    for (const sig of early) await this.onSignal(sig)
    this.pullSignals()
  }

  async hangup() {
    const { phase, call } = this.s
    if (phase === 'idle') return
    if (phase === 'incoming') return this.decline()
    if (call) await this.api.leave(call.id).catch(() => {})
    this.teardown(); this.finish('ended')
  }

  /* ----- incoming rings ----- */
  async checkRinging() {
    if (this.s.phase !== 'idle' || this.isBusy() || document.visibilityState === 'hidden') return
    try { for (const m of await this.api.ringingForMe()) { await this.showIncoming(m.call_id); if (this.s.phase !== 'idle') break } } catch { /* ignore */ }
  }
  async showIncoming(callId) {
    if (this.s.phase !== 'idle' || this.isBusy()) return
    const call = await this.api.getCall(callId)
    if (!call || call.ended_at || call.started_by === this.meId) return
    if (this.s.phase !== 'idle' || this.isBusy()) return
    this.set({ ...this.blank(), phase: 'incoming', call, kind: call.kind, roomId: call.room_id, starterId: call.started_by })
    clearTimeout(this.ringTimer)
    this.ringTimer = setTimeout(() => { if (this.s.phase === 'incoming') { this.teardown(); this.finish('missed') } }, RING_MS)
  }

  /* ----- events from the database ----- */
  onMemberRow(m) {
    this.onFeed?.()
    if (m.profile_id === this.meId) {
      if (m.state === 'ringing' && this.s.phase === 'idle' && Date.now() - new Date(m.invited_at).getTime() < RING_MS) this.showIncoming(m.call_id)
      else if (this.s.phase === 'incoming' && this.s.call?.id === m.call_id && m.state !== 'ringing') { clearTimeout(this.ringTimer); this.teardown(); this.finish('ended') }
    }
    if (this.entered && this.s.call?.id === m.call_id) this.refreshSoon()
  }
  onCallRow(c) {
    this.onFeed?.()
    if (c.ended_at && this.s.call?.id === c.id) {
      if (this.s.phase === 'incoming') { clearTimeout(this.ringTimer); this.teardown(); this.finish('missed') }
      else if (this.entered) this.refreshSoon()
    }
  }
  refreshSoon() { clearTimeout(this.refreshT); this.refreshT = setTimeout(() => this.refresh(), 150) }
  async refresh() {
    const call = this.s.call
    if (!this.entered || !call) return
    try {
      const members = await this.api.members(call.id)
      if (!this.entered || this.s.call?.id !== call.id) return
      this.reconcile(members)
    } catch { /* try again on the next tick */ }
  }
  tick() {
    if (this.s.phase === 'idle') this.checkRinging()
    else if (this.entered) { this.refresh(); this.pullSignals() }
  }
  async ping() {
    const call = this.s.call
    if (!this.entered || !call) return
    try { await this.api.ping(call.id) }
    catch (e) { if (/not in this call/i.test(e?.message || '')) this.dropped('You were disconnected from the call.') }
  }
  dropped(message) { if (!this.entered) return; this.teardown(); this.finish('error', message) }

  /* ----- who should be connected to whom ----- */
  reconcile(members) {
    const me = members.find((m) => m.profile_id === this.meId)
    if (me && me.state !== 'joined') return this.dropped('You were disconnected from the call.')
    const joined = new Set(members.filter((m) => m.state === 'joined' && m.profile_id !== this.meId).map((m) => m.profile_id))
    for (const id of [...this.rec.keys()]) if (!joined.has(id)) this.dropPeer(id)
    for (const id of joined) {
      const r = this.rec.get(id)
      if (!r) this.ensurePeer(id)
      else if (r.shell) { delete r.shell; this.arm(r); if (this.meId < id) this.initiate(r) }
    }
    this.s = { ...this.s, members }
    this.publish()

    // alone and nobody is still ringing -> the call is over
    const ringing = members.some((m) => m.state === 'ringing')
    if (!joined.size && !ringing) {
      if (!this.aloneT) this.aloneT = setTimeout(() => this.endAlone(), 4000)
    } else if (this.aloneT) { clearTimeout(this.aloneT); this.aloneT = null }
  }

  async endAlone() {
    this.aloneT = null
    if (!this.entered || this.rec.size) return
    const never = !this.hadPeer, call = this.s.call
    if (call) await this.api.leave(call.id).catch(() => {})
    this.teardown()
    this.finish(never ? 'nobody' : 'ended', never ? 'Nobody joined the call.' : 'Everyone has left the call.')
  }

  /* ----- one connection per person ----- */
  ensurePeer(id) {
    const rec = { id, pc: null, localSid: null, remoteSid: null, cands: [], stream: null, state: 'connecting', retries: 0, timer: null }
    this.rec.set(id, rec)
    this.arm(rec)
    if (this.meId < id) this.initiate(rec)       // smaller id always makes the offer
    return rec
  }
  arm(rec) { clearTimeout(rec.timer); rec.timer = setTimeout(() => { if (rec.state !== 'connected') this.retry(rec) }, CONNECT_MS) }
  dropPeer(id) {
    const rec = this.rec.get(id); if (!rec) return
    clearTimeout(rec.timer); clearTimeout(rec.dropT)
    try { rec.pc?.close() } catch { /* ignore */ }
    this.rec.delete(id)
  }
  resetPc(rec) {
    clearTimeout(rec.timer); clearTimeout(rec.dropT)
    try { rec.pc?.close() } catch { /* ignore */ }
    rec.pc = null; rec.remoteSid = null; rec.stream = null; rec.state = 'connecting'
  }
  retry(rec) {
    clearTimeout(rec.timer)
    if (this.rec.get(rec.id) !== rec || !this.entered) return
    if (rec.retries >= MAX_RETRIES) { rec.state = 'failed'; this.publish(); return }
    rec.retries++
    this.resetPc(rec); this.publish()
    setTimeout(() => {
      if (this.rec.get(rec.id) !== rec || !this.entered) return
      this.arm(rec)
      if (this.meId < rec.id) this.initiate(rec)
    }, 1500 + Math.random() * 600)
  }
  retryPeer(id) { const rec = this.rec.get(id); if (!rec) return; rec.retries = 0; rec.state = 'connecting'; this.resetPc(rec); this.arm(rec); this.publish(); if (this.meId < id) this.initiate(rec) }

  createPc(rec) {
    const pc = new this.PC({ iceServers: this.ice })
    rec.pc = pc; rec.localSid = rnd(); rec.stream = new MediaStream()
    const callId = this.s.call.id, sid = rec.localSid
    const local = this.s.local
    for (const t of local?.getTracks() || []) pc.addTrack(t, local)
    pc.ontrack = (e) => {
      if (rec.pc !== pc) return
      if (e.streams?.[0]) rec.stream = e.streams[0]
      else rec.stream.addTrack(e.track)
      e.track.onmute = e.track.onunmute = () => this.publish()
      this.publish()
    }
    pc.onicecandidate = (e) => { if (e.candidate && rec.pc === pc) this.api.signal(callId, rec.id, 'candidate', { c: e.candidate.toJSON(), sid }).catch(() => {}) }
    pc.onconnectionstatechange = () => {
      if (rec.pc !== pc) return
      const st = pc.connectionState
      if (st === 'connected') {
        clearTimeout(rec.timer); clearTimeout(rec.dropT); rec.state = 'connected'; rec.retries = 0; this.hadPeer = true
        this.capBitrate(pc); this.publish()
      } else if (st === 'disconnected') {
        clearTimeout(rec.dropT); rec.dropT = setTimeout(() => { if (rec.pc === pc && pc.connectionState !== 'connected') this.retry(rec) }, 8000)
      } else if (st === 'failed') this.retry(rec)
    }
    return pc
  }
  capBitrate(pc) {
    // keeps six phones from flooding each other: each outgoing video stream is limited
    try {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue
        const p = sender.getParameters(); if (!p.encodings?.length) p.encodings = [{}]
        p.encodings[0].maxBitrate = 450000
        sender.setParameters(p).catch(() => {})
      }
    } catch { /* optional */ }
  }

  async initiate(rec) {
    try {
      const pc = this.createPc(rec)
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
      await this.api.signal(this.s.call.id, rec.id, 'offer', { type: offer.type, sdp: offer.sdp, sid: rec.localSid })
    } catch { this.retry(rec) }
  }

  /* ----- connection set-up messages ----- */
  async onSignal(sig) {
    if (sig.to_id !== this.meId) return
    if (this.seen.has(sig.id)) return
    if (!this.entered) { if (this.s.phase === 'joining') this.buffer.push(sig); return }   // arrived while we were still joining
    if (sig.call_id !== this.s.call?.id) return
    this.seen.add(sig.id)
    const rec = this.rec.get(sig.from_id)
    const p = sig.payload || {}
    try {
      if (sig.kind === 'candidate') {
        const r = rec || this.ensureShell(sig.from_id)
        r.cands.push({ sid: p.sid, c: p.c }); await this.flush(r)
      } else if (sig.kind === 'offer') {
        if (this.meId < sig.from_id) return                 // only the smaller id offers; stray offers are ignored
        const r = rec || this.ensurePeer(sig.from_id)
        delete r.shell
        if (!r.pc || r.remoteSid !== p.sid) { this.resetPc(r); this.createPc(r); r.remoteSid = p.sid; this.arm(r) }
        await r.pc.setRemoteDescription({ type: p.type, sdp: p.sdp })
        await this.flush(r)
        const answer = await r.pc.createAnswer(); await r.pc.setLocalDescription(answer)
        await this.api.signal(sig.call_id, r.id, 'answer', { type: answer.type, sdp: answer.sdp, sid: r.localSid, re: p.sid })
      } else if (sig.kind === 'answer') {
        if (!rec || !rec.pc || p.re !== rec.localSid) return
        rec.remoteSid = p.sid
        await rec.pc.setRemoteDescription({ type: p.type, sdp: p.sdp })
        await this.flush(rec)
      }
    } catch { if (rec) this.retry(rec) }
  }
  ensureShell(id) { // a network candidate can arrive before we have noticed the person joined
    if (!this.rec.has(id)) this.rec.set(id, { id, pc: null, localSid: null, remoteSid: null, cands: [], stream: null, state: 'connecting', retries: 0, timer: null, shell: true })
    return this.rec.get(id)
  }
  async flush(rec) {
    if (!rec.pc?.remoteDescription || !rec.remoteSid) return
    const todo = rec.cands.splice(0)
    for (const x of todo) if (x.sid === rec.remoteSid && x.c) await rec.pc.addIceCandidate(x.c).catch(() => {})
  }
  async pullSignals() {   // safety net in case the live feed missed a message
    const call = this.s.call
    if (!this.entered || !call) return
    try { for (const sig of await this.api.mySignals(call.id)) await this.onSignal(sig) } catch { /* ignore */ }
  }

  /* ----- controls ----- */
  toggleMute() {
    const on = !this.s.muted
    this.s.local?.getAudioTracks().forEach((t) => { t.enabled = !on })
    this.set({ muted: on })
  }
  toggleCamera() {
    const off = !this.s.camOff
    this.s.local?.getVideoTracks().forEach((t) => { t.enabled = !off })
    this.set({ camOff: off })
  }

  /* ----- state published to the screen ----- */
  publish() {
    const peers = {}
    for (const [id, r] of this.rec) peers[id] = { state: r.state, stream: r.stream }
    this.set({ peers })
  }

  /* ----- cleanup ----- */
  teardown() {
    clearInterval(this.hb); clearTimeout(this.ringTimer); clearTimeout(this.aloneT); clearTimeout(this.refreshT)
    this.aloneT = null; this.hb = null
    this.s.local?.getTracks().forEach((t) => t.stop())
    for (const id of [...this.rec.keys()]) this.dropPeer(id)
    this.entered = false; this.buffer = []; this.seen.clear(); this.hadPeer = false
  }
  abort(message) { this.teardown(); this.s = this.blank(); this.onChange?.(this.s); this.onEnded?.({ reason: 'error', message, call: null, kind: null, seconds: 0 }) }
  finish(reason, message) {
    const prev = this.s
    this.s = this.blank()
    this.onChange?.(this.s)
    this.onEnded?.({ reason, message, call: prev.call, kind: prev.kind, roomId: prev.roomId, seconds: prev.startedAt ? Math.round((Date.now() - prev.startedAt) / 1000) : 0 })
  }
}
