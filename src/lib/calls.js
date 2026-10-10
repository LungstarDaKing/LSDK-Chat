// Free voice / video calls, directly between two browsers (WebRTC, encrypted with DTLS-SRTP).
// The database only carries the "ringing" state and the connection set-up messages; the audio
// and video never pass through it. The rule "you must have messaged each other first" is
// enforced by the database function start_call().
import { supabase } from './supabase.js'
import { CONFIG } from '../config.js'

const RING_MS = 45000
const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]

export function iceServers() {
  const extra = Array.isArray(CONFIG.iceServers) ? CONFIG.iceServers : []
  return [...DEFAULT_ICE, ...extra]
}

export function supabaseCallApi(meId) {
  return {
    start: async (callee, kind) => { const { data, error } = await supabase.rpc('start_call', { p_callee: callee, p_kind: kind }); if (error) throw error; return data },
    answer: async (id) => { const { error } = await supabase.rpc('answer_call', { p_call: id }); if (error) throw error },
    decline: async (id) => { await supabase.rpc('decline_call', { p_call: id }) },
    end: async (id) => { await supabase.rpc('end_call', { p_call: id }) },
    signal: async (id, kind, payload) => { const { error } = await supabase.rpc('send_call_signal', { p_call: id, p_kind: kind, p_payload: payload }); if (error) throw error },
    getCall: async (id) => (await supabase.from('calls').select('*').eq('id', id).maybeSingle()).data,
    ringingForMe: async () => (await supabase.from('calls').select('*').eq('callee_id', meId).eq('status', 'ringing')
      .gt('created_at', new Date(Date.now() - 60000).toISOString())).data || [],
    listen(onCall, onSignal) {
      const ch = supabase.channel('calls-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, (p) => p.new && onCall(p.new))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals' }, (p) => p.new && onSignal(p.new))
        .subscribe()
      return () => supabase.removeChannel(ch)
    },
  }
}

export async function loadCallLog(limit = 50) {
  const { data, error } = await supabase.from('calls').select('id, caller_id, callee_id, kind, status, created_at, answered_at, ended_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}
export const clearCallLog = () => supabase.rpc('hide_call_history')

export const callsSupported = () => !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia)

const mediaError = (e) => new Error(e?.name === 'NotAllowedError' ? 'Microphone/camera access was blocked. Allow it in your browser\'s address bar and try again.'
  : e?.name === 'NotFoundError' ? 'No microphone or camera was found.' : 'Could not start the microphone/camera.')

// phases: idle | outgoing | incoming | connecting | active
export class CallManager {
  constructor({ api, meId, onChange, onEnded, rtc = {} }) {
    this.api = api; this.meId = meId; this.onChange = onChange; this.onEnded = onEnded
    this.PC = rtc.RTCPeerConnection || window.RTCPeerConnection
    this.getMedia = rtc.getUserMedia || ((c) => navigator.mediaDevices.getUserMedia(c))
    this.ice = rtc.iceServers || iceServers()
    this.s = this.blank()
    this.buffer = []
    this.unlisten = api.listen((c) => this.onCallRow(c), (sig) => this.onSignal(sig))
    this.poll = setInterval(() => this.checkRinging(), 8000)
  }
  blank() { return { phase: 'idle', call: null, peerId: null, kind: null, muted: false, camOff: false, local: null, remote: null, error: null, startedAt: null } }
  set(patch) { this.s = { ...this.s, ...patch }; this.onChange?.(this.s) }
  destroy() { clearInterval(this.poll); this.unlisten?.(); this.cleanup(); }

  /* ----- outgoing ----- */
  async start(peerId, kind) {
    if (this.s.phase !== 'idle') throw new Error('You are already in a call.')
    this.set({ ...this.blank(), phase: 'outgoing', peerId, kind })
    try {
      const local = await this.media(kind)
      const id = await this.api.start(peerId, kind)
      const call = await this.api.getCall(id)
      if (!call) throw new Error('Could not start the call.')
      if (call.status === 'busy') { this.cleanup(); this.set({ error: 'They are on another call.' }); return this.finish('busy') }
      this.set({ call, local })
      this.ringTimeout = setTimeout(() => { if (this.s.phase === 'outgoing') this.hangup() }, RING_MS)
    } catch (e) { this.cleanup(); this.set({ ...this.blank(), error: e.message }); this.finish('error', e.message); throw e }
  }

  async media(kind) {
    try { return await this.getMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false }) }
    catch (e) { throw mediaError(e) }
  }

  /* ----- incoming ----- */
  async checkRinging() {
    if (this.s.phase !== 'idle' || document.visibilityState === 'hidden') return
    try { for (const c of await this.api.ringingForMe()) this.onCallRow(c) } catch { /* ignore */ }
  }

  async accept() {
    const { call, kind, phase } = this.s
    if (phase !== 'incoming') return
    try {
      const local = await this.media(kind)
      await this.api.answer(call.id)
      this.set({ phase: 'connecting', local })
      this.makePc(local)
    } catch (e) { this.set({ error: e.message }); await this.api.decline(call.id).catch(() => {}); this.cleanup(); this.finish('error', e.message) }
  }
  async decline() { const c = this.s.call; if (!c) return; await this.api.decline(c.id).catch(() => {}); this.cleanup(); this.finish('declined') }
  async hangup() {
    const c = this.s.call; const phase = this.s.phase
    if (phase === 'idle') return
    if (c) await this.api.end(c.id).catch(() => {})
    this.cleanup(); this.finish(phase === 'outgoing' ? 'cancelled' : 'ended')
  }

  /* ----- events from the database ----- */
  onCallRow(c) {
    if (c.caller_id !== this.meId && c.callee_id !== this.meId) return
    const s = this.s
    if (c.status === 'ringing' && c.callee_id === this.meId) {
      if (s.phase !== 'idle' || Date.now() - new Date(c.created_at).getTime() > 60000) return
      this.set({ ...this.blank(), phase: 'incoming', call: c, peerId: c.caller_id, kind: c.kind })
      return
    }
    if (!s.call || s.call.id !== c.id) return
    if (c.status === 'accepted' && c.caller_id === this.meId && s.phase === 'outgoing') {
      clearTimeout(this.ringTimeout)
      this.set({ phase: 'connecting', call: c })
      this.makePc(s.local, true)
    } else if (['declined', 'missed', 'ended', 'busy'].includes(c.status)) {
      const reason = c.status
      const wasActive = ['connecting', 'active'].includes(s.phase)
      this.cleanup()
      this.finish(reason, reason === 'declined' && !wasActive ? 'They declined the call.' : null)
    }
  }

  async onSignal(sig) {
    if (sig.to_id !== this.meId) return
    if (!this.pc || this.s.call?.id !== sig.call_id) { this.buffer.push(sig); return }
    await this.applySignal(sig)
  }
  async applySignal(sig) {
    const pc = this.pc
    try {
      if (sig.kind === 'offer') {
        await pc.setRemoteDescription(sig.payload)
        await this.flushCandidates()
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer)
        await this.api.signal(sig.call_id, 'answer', { type: answer.type, sdp: answer.sdp })
      } else if (sig.kind === 'answer') {
        await pc.setRemoteDescription(sig.payload); await this.flushCandidates()
      } else if (sig.kind === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(sig.payload).catch(() => {})
        else this.cands.push(sig.payload)
      }
    } catch (e) { this.fail('Could not connect the call.') }
  }
  async flushCandidates() { for (const c of this.cands.splice(0)) await this.pc.addIceCandidate(c).catch(() => {}) }

  /* ----- WebRTC ----- */
  makePc(local, isCaller = false) {
    const pc = new this.PC({ iceServers: this.ice })
    this.pc = pc; this.cands = []
    const callId = this.s.call.id
    for (const t of local.getTracks()) pc.addTrack(t, local)
    const remote = new MediaStream()
    pc.ontrack = (e) => { remote.addTrack(e.track); this.set({ remote }) }
    pc.onicecandidate = (e) => { if (e.candidate) this.api.signal(callId, 'candidate', e.candidate.toJSON()).catch(() => {}) }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') { clearTimeout(this.dropTimer); if (this.s.phase !== 'active') this.set({ phase: 'active', startedAt: Date.now() }) }
      else if (st === 'disconnected') { this.dropTimer = setTimeout(() => this.fail('The connection was lost.'), 8000) }
      else if (st === 'failed') this.fail('Could not connect. Some networks (strict firewalls, some mobile networks) block direct calls.')
    }
    this.connectTimer = setTimeout(() => { if (this.s.phase === 'connecting') this.fail('Could not connect. Some networks (strict firewalls, some mobile networks) block direct calls.') }, 25000)
    const mine = this.buffer.filter((b) => b.call_id === callId); this.buffer = []
    ;(async () => {
      if (isCaller) {
        try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await this.api.signal(callId, 'offer', { type: offer.type, sdp: offer.sdp }) }
        catch { this.fail('Could not start the call.') }
      }
      for (const m of mine) await this.applySignal(m)
    })()
  }

  fail(msg) { const c = this.s.call; if (c) this.api.end(c.id).catch(() => {}); this.cleanup(); this.finish('error', msg) }

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

  cleanup() {
    clearTimeout(this.ringTimeout); clearTimeout(this.connectTimer); clearTimeout(this.dropTimer)
    this.s.local?.getTracks().forEach((t) => t.stop())
    if (this.pc) { try { this.pc.close() } catch { /* ignore */ } }
    this.pc = null; this.cands = []; this.buffer = []
  }
  finish(reason, message) {
    const prev = this.s
    this.s = this.blank()
    this.onChange?.(this.s)
    this.onEnded?.({ reason, message, call: prev.call, peerId: prev.peerId, kind: prev.kind, seconds: prev.startedAt ? Math.round((Date.now() - prev.startedAt) / 1000) : 0 })
  }
}
