// Voice notes: record from the microphone with MediaRecorder.
export const MAX_VOICE_MS = 5 * 60 * 1000
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const EXT = { 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }

export const voiceSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
const pickMime = () => CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) || ''

export async function startRecording({ onTick, onAutoStop } = {}) {
  if (!voiceSupported()) throw new Error('Voice notes are not supported in this browser.')
  let stream
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }) }
  catch (e) {
    throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser\'s address bar and try again.'
      : e?.name === 'NotFoundError' ? 'No microphone was found.' : 'Could not start the microphone.')
  }
  const mime = pickMime()
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks = []
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
  const t0 = performance.now()
  let finished = null
  const release = () => stream.getTracks().forEach((t) => t.stop())
  const tick = setInterval(() => {
    const ms = performance.now() - t0
    onTick?.(ms)
    if (ms >= MAX_VOICE_MS) { api.stop().then((r) => onAutoStop?.(r), () => {}) }
  }, 200)
  rec.start(250)

  const api = {
    // -> { file, durationMs } | null (too short)
    stop() {
      if (finished) return finished
      finished = new Promise((resolve) => {
        rec.onstop = () => {
          clearInterval(tick); release()
          const durationMs = Math.round(performance.now() - t0)
          const base = (rec.mimeType || mime || 'audio/webm').split(';')[0]
          const type = EXT[base] ? base : 'audio/webm'
          const blob = new Blob(chunks, { type })
          if (durationMs < 500 || !blob.size) return resolve(null)
          const raw = { file: new File([blob], `voice-note.${EXT[type]}`, { type }), durationMs: Math.min(durationMs, MAX_VOICE_MS) }
          toWav(blob).then((w) => resolve({ file: new File([w.blob], 'voice-note.wav', { type: 'audio/wav' }), durationMs: Math.min(w.durationMs || raw.durationMs, MAX_VOICE_MS) }),
            () => resolve(raw))               // could not convert: send the original recording
        }
        try { rec.state !== 'inactive' ? rec.stop() : rec.onstop() } catch { rec.onstop() }
      })
      return finished
    },
    cancel() { clearInterval(tick); chunks.length = 0; finished = Promise.resolve(null); try { if (rec.state !== 'inactive') { rec.onstop = null; rec.stop() } } catch { /* ignore */ } release() },
  }
  return api
}

// Browsers record voice notes as WebM/Opus without a length or seek table, which many players
// then play wrongly (no sound, a progress bar that never ends). So the recording is converted to a
// plain mono 16 kHz WAV: it has an exact length, plays everywhere and can be skipped through.
const WAV_RATE = 16000
export async function toWav(blob) {
  const AC = window.AudioContext || window.webkitAudioContext
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!AC || !OAC) throw new Error('no audio api')
  const ctx = new AC()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const frames = Math.max(1, Math.ceil(decoded.duration * WAV_RATE))
    const off = new OAC(1, frames, WAV_RATE)
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start()
    const pcm = (await off.startRendering()).getChannelData(0)
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf)
    const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true)
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, WAV_RATE, true); v.setUint32(28, WAV_RATE * 2, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true)
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
    return { blob: new Blob([buf], { type: 'audio/wav' }), durationMs: Math.round(decoded.duration * 1000) }
  } finally { ctx.close?.() }
}

export const fmtDuration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
