// Voice notes: record from the microphone with MediaRecorder.
export const MAX_VOICE_MS = 5 * 60 * 1000
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const EXT = { 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' }

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
          resolve(durationMs < 500 || !blob.size ? null : { file: new File([blob], `voice-note.${EXT[type]}`, { type }), durationMs: Math.min(durationMs, MAX_VOICE_MS) })
        }
        try { rec.state !== 'inactive' ? rec.stop() : rec.onstop() } catch { rec.onstop() }
      })
      return finished
    },
    cancel() { clearInterval(tick); chunks.length = 0; finished = Promise.resolve(null); try { if (rec.state !== 'inactive') { rec.onstop = null; rec.stop() } } catch { /* ignore */ } release() },
  }
  return api
}

export const fmtDuration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
