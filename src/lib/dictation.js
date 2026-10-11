// Dictation (speak to type) using the browser's own speech recognition.
// NOTE: in Chrome/Edge/Safari the audio is processed by the browser maker's servers, not by LSDK Chat.
// Which languages work depends on the browser; unsupported ones report an error.
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition
export const dictationSupported = () => !!SR()

export function startDictation({ lang, onInterim, onFinal, onEnd, onError }) {
  const rec = new (SR())()
  rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) onFinal?.(r[0].transcript.trim()); else interim += r[0].transcript
    }
    onInterim?.(interim)
  }
  rec.onerror = (e) => onError?.(e.error)
  rec.onend = () => onEnd?.()
  try { rec.start() } catch (e) { onError?.('start-failed') }
  return () => { try { rec.stop() } catch { /* already stopped */ } }
}

// "send", "send message", "clear", "cancel" ... (spoken commands, English)
export function commandOf(text) {
  const t = text.toLowerCase().replace(/[.,!?]/g, '').trim()
  if (/^(send|send it|send message|send the message)$/.test(t)) return 'send'
  if (/^(clear|clear message|clear it|delete that|cancel|never mind|start over)$/.test(t)) return 'clear'
  if (/^(stop|stop dictation|stop listening)$/.test(t)) return 'stop'
  return null
}
