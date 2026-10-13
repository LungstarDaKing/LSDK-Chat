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

/* ---------- relay (TURN) credentials: lets calls connect on phone networks and strict firewalls ---------- */
let iceCache = null
export async function loadIceServers() {
  const base = iceServers()
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
  } catch { /* the relay is optional: fall back to the normal servers */ }
  return base
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
// Screen sharing needs getDisplayMedia, which most phone browsers do not offer.
export const screenShareSupported = () => !!navigator.mediaDevices?.getDisplayMedia

// Asks the browser for the screen, with sound if the browser and the chosen source can provide it
// (Chrome / Edge on a computer: a browser tab, or the whole screen on Windows).
// Returns { stream, hasAudio }. The sound is not processed like a microphone (no echo cancelling, no noise
// suppression), because it is music or video, and the browser is told not to also play it on the sharer's speakers
// and not to include the call's own sound, so the other people do not hear themselves.
export async function captureScreen(getDisplay) {
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: true, restrictOwnAudio: true }
  let stream
  try { stream = await getDisplay({ video: { frameRate: { ideal: 15, max: 30 } }, audio, systemAudio: 'include', surfaceSwitching: 'include' }) }
  catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') throw e
    stream = await getDisplay({ video: true, audio: true })     // an older browser that dislikes the extra options
  }
  for (const t of stream.getVideoTracks()) { try { t.contentHint = 'detail' } catch { /* optional */ } }
  return { stream, hasAudio: stream.getAudioTracks().length > 0 }
}
export const NO_SCREEN_SOUND = 'Sharing without sound. For sound, pick a Chrome tab (or the whole screen on Windows) and tick "Share audio". Firefox, Safari and phones cannot share sound.'

const mediaError = (e) => new Error(e?.name === 'NotAllowedError' ? 'Microphone/camera access was blocked. Allow it in your browser\'s address bar and try again.'
  : e?.name === 'NotFoundError' ? 'No microphone or camera was found.' : 'Could not start the microphone/camera.')

// phases: idle | outgoing | incoming | connecting | active
export class CallManager {
  constructor({ api, meId, onChange, onEnded, onNotice, rtc = {} }) {
    this.onNotice = onNotice
    this.api = api; this.meId = meId; this.onChange = onChange; this.onEnded = onEnded
    this.PC = rtc.RTCPeerConnection || window.RTCPeerConnection
    this.getMedia = rtc.getUserMedia || ((c) => navigator.mediaDevices.getUserMedia(c))
    this.getScreen = rtc.getDisplayMedia || (navigator.mediaDevices?.getDisplayMedia ? (c) => navigator.mediaDevices.getDisplayMedia(c) : null)
    this.fixedIce = !!rtc.iceServers
    this.ice = rtc.iceServers || iceServers()
    this.s = this.blank()
    this.buffer = []
    this.unlisten = api.listen((c) => this.onCallRow(c), (sig) => this.onSignal(sig))
    this.poll = setInterval(() => this.checkRinging(), 8000)
  }
  blank() { return { phase: 'idle', call: null, peerId: null, kind: null, muted: false, camOff: false, local: null, remote: null, remoteCam: false, screen: null, screenAudio: false, remoteScreen: null, error: null, startedAt: null } }
  set(patch) { this.s = { ...this.s, ...patch }; this.onChange?.(this.s) }
  destroy() { clearInterval(this.poll); this.unlisten?.(); this.cleanup(); }

  /* ----- outgoing ----- */
  async start(peerId, kind) {
    if (this.s.phase !== 'idle') throw new Error('You are already in a call.')
    this.set({ ...this.blank(), phase: 'outgoing', peerId, kind })
    try {
      const local = await this.media(kind)
      await this.prepIce()
      const id = await this.api.start(peerId, kind)
      const call = await this.api.getCall(id)
      if (!call) throw new Error('Could not start the call.')
      if (call.status === 'busy') { this.cleanup(); this.set({ error: 'They are on another call.' }); return this.finish('busy') }
      this.set({ call, local })
      this.ringTimeout = setTimeout(() => { if (this.s.phase === 'outgoing') this.hangup() }, RING_MS)
    } catch (e) { this.cleanup(); this.set({ ...this.blank(), error: e.message }); this.finish('error', e.message); throw e }
  }

  async prepIce() { if (!this.fixedIce) this.ice = await loadIceServers() }

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
      await this.prepIce()
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
      if (sig.kind === 'offer' || sig.kind === 'answer') {
        // "Perfect negotiation": if both sides change the call at once, the callee (polite) yields.
        const collision = sig.kind === 'offer' && (this.makingOffer || pc.signalingState !== 'stable')
        this.ignoreOffer = !this.polite && collision
        if (this.ignoreOffer) return
        await pc.setRemoteDescription(sig.payload)
        await this.flushCandidates()
        if (sig.kind === 'offer') {
          const answer = await pc.createAnswer(); await pc.setLocalDescription(answer)
          await this.api.signal(sig.call_id, 'answer', { type: answer.type, sdp: answer.sdp })
        }
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
    this.pc = pc; this.cands = []; this.ready = false; this.makingOffer = false; this.ignoreOffer = false
    this.polite = this.s.call.callee_id === this.meId
    this.mainId = null; this.screenId = null; this.screenSenders = []; this.dc = null
    const callId = this.s.call.id
    for (const t of local.getTracks()) pc.addTrack(t, local)
    const remote = new MediaStream()
    pc.ontrack = (e) => {
      const st = e.streams[0]
      if (e.track.kind === 'audio' && !this.mainId) this.mainId = st?.id || 'main'
      // anything that is not the person's own camera/microphone stream is their shared screen (picture and sound)
      if (st && (st.id === this.screenId || (this.mainId && st.id !== this.mainId))) {
        this.screenId = st.id
        const gone = () => { if (this.s.remoteScreen === st && !st.getTracks().some((t) => t.readyState === 'live')) this.set({ remoteScreen: null }) }
        st.onremovetrack = gone; e.track.onended = gone
        this.set({ remoteScreen: st }); return
      }
      remote.addTrack(e.track)
      this.set(e.track.kind === 'video' ? { remote, remoteCam: true, kind: 'video' } : { remote })
    }
    pc.ondatachannel = (e) => this.setupChannel(e.channel)
    if (isCaller) this.setupChannel(pc.createDataChannel('ctl'))
    pc.onnegotiationneeded = async () => {
      if (!this.ready) return
      try {
        this.makingOffer = true
        const offer = await pc.createOffer()
        if (pc.signalingState !== 'stable') return
        await pc.setLocalDescription(offer)
        await this.api.signal(callId, 'offer', { type: offer.type, sdp: offer.sdp })
      } catch { /* the next change will try again */ } finally { this.makingOffer = false }
    }
    pc.onicecandidate = (e) => { if (e.candidate) this.api.signal(callId, 'candidate', e.candidate.toJSON()).catch(() => {}) }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') { clearTimeout(this.dropTimer); this.ready = true; if (this.s.phase !== 'active') this.set({ phase: 'active', startedAt: Date.now() }) }
      else if (st === 'disconnected') { this.dropTimer = setTimeout(() => this.fail('The connection was lost.'), 8000) }
      else if (st === 'failed') this.fail('Could not connect. Some networks (strict firewalls, some mobile networks) block direct calls.')
    }
    this.connectTimer = setTimeout(() => { if (this.s.phase === 'connecting') this.fail('Could not connect. Some networks (strict firewalls, some mobile networks) block direct calls.') }, 25000)
    const mine = this.buffer.filter((b) => b.call_id === callId); this.buffer = []
    ;(async () => {
      if (isCaller) {
        try { this.makingOffer = true; const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await this.api.signal(callId, 'offer', { type: offer.type, sdp: offer.sdp }) }
        catch { this.fail('Could not start the call.') } finally { this.makingOffer = false }
      }
      for (const m of mine) await this.applySignal(m)
    })()
  }

  fail(msg) { const c = this.s.call; if (c) this.api.end(c.id).catch(() => {}); this.cleanup(); this.finish('error', msg) }

  /* ----- small control channel (tells the other side what a stream is) ----- */
  setupChannel(dc) {
    this.dc = dc
    dc.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data) } catch { return }
      if (m?.t !== 'screen') return
      if (m.on) { this.screenId = String(m.id || ''); return }
      this.screenId = null; this.set({ remoteScreen: null })
    }
  }
  tell(msg) { try { if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(msg)) } catch { /* ignore */ } }

  /* ----- change the call while it is running ----- */
  get canChange() { return this.s.phase === 'active' && !!this.pc }

  // Voice call -> video call (or turn the camera back on).
  async enableVideo() {
    if (!this.canChange) return
    const local = this.s.local
    const existing = local.getVideoTracks()[0]
    if (existing) { existing.enabled = true; this.set({ camOff: false, kind: 'video' }); return }
    let cam
    try { cam = (await this.getMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })).getVideoTracks()[0] }
    catch (e) { this.set({ error: mediaError(e).message }); throw mediaError(e) }
    if (!this.canChange) { cam.stop(); return }
    local.addTrack(cam)
    this.pc.addTrack(cam, local)       // triggers a new offer to the other person
    this.set({ camOff: false, kind: 'video', local })
  }

  async startScreenShare() {
    if (!this.canChange || this.s.screen) return
    if (!this.getScreen) throw new Error('This browser cannot share its screen. Try Chrome or Edge on a computer.')
    let cap
    try { cap = await captureScreen(this.getScreen) }
    catch (e) { if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return; throw new Error('Could not start screen sharing.') }
    const { stream, hasAudio } = cap
    if (!this.canChange) { stream.getTracks().forEach((t) => t.stop()); return }
    const vt = stream.getVideoTracks()[0]
    vt.onended = () => this.stopScreenShare()    // the browser's own "Stop sharing" button
    this.tell({ t: 'screen', on: true, id: stream.id })
    this.screenSenders = stream.getTracks().map((t) => this.pc.addTrack(t, stream))
    this.set({ screen: stream, screenAudio: hasAudio })
    if (!hasAudio) this.onNotice?.(NO_SCREEN_SOUND)
  }
  stopScreenShare() {
    const st = this.s.screen
    if (!st) return
    st.getTracks().forEach((t) => { t.onended = null; t.stop() })
    if (this.pc) for (const sd of this.screenSenders) { try { this.pc.removeTrack(sd) } catch { /* ignore */ } }
    this.screenSenders = []
    this.tell({ t: 'screen', on: false })
    this.set({ screen: null, screenAudio: false })
  }

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
    this.s.screen?.getTracks().forEach((t) => { t.onended = null; t.stop() })
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
