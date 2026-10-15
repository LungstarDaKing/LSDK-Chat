// LUNEX client for LSDKChat (no dependencies).
//
//   import { LunexClient, toHistory, chatContext } from './lunex.js'
//   import { supabase } from './supabase.js'
//   export const lunex = new LunexClient({
//     baseUrl: CONFIG.lunexUrl,                                   // e.g. https://lunex.onrender.com
//     getToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
//   })
//
//   const r = await lunex.ask('how do I make a group call?', { history, onStatus: (t) => ..., onDelta: (t) => ... })
//   r -> { reply, skill, sources: [{ title, url? }], remainingToday }

export class LunexError extends Error {
  constructor(message, status = 0, retryAfter = 0) { super(message); this.name = 'LunexError'; this.status = status; this.retryAfter = retryAfter }
}

export class LunexClient {
  constructor({ baseUrl, getToken, timeoutMs = 60000 }) { this.baseUrl = (baseUrl || '').replace(/\/$/, ''); this.getToken = getToken; this.timeoutMs = timeoutMs }

  async #headers() {
    const token = await this.getToken?.()
    if (!token) throw new LunexError('Please sign in to use LUNEX.', 401)
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }
  static async #fail(res) {
    let msg = 'LUNEX is not available right now.'
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : (j.detail?.[0]?.msg ? 'That message could not be sent (too long?).' : msg) } catch { /* keep default */ }
    return new LunexError(msg, res.status, Number(res.headers.get('retry-after')) || 0)
  }

  /** Ask LUNEX. Streams the reply: onStatus("Searching the web…"), onDelta("piece of text"). Resolves with the full answer. */
  async ask(message, { history = [], skill, context, locale, signal, onStatus, onDelta } = {}) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    signal?.addEventListener('abort', () => ctl.abort())
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/stream`, {
        method: 'POST', headers: await this.#headers(), signal: ctl.signal,
        body: JSON.stringify({ message, history: toHistory(history), skill, context, locale: locale || navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })
      if (!res.ok) throw await LunexClient.#fail(res)
      const reader = res.body.getReader(), dec = new TextDecoder()
      let buf = '', reply = '', done = { skill: 'chat', sources: [], remaining_today: null }
      for (;;) {
        const { value, done: end } = await reader.read()
        if (end) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2)
          const data = block.split('\n').find((l) => l.startsWith('data: '))
          if (!data) continue
          const ev = JSON.parse(data.slice(6))
          if (ev.type === 'status') onStatus?.(ev.text)
          else if (ev.type === 'delta') { reply += ev.text; onDelta?.(ev.text) }
          else if (ev.type === 'done') done = ev
          else if (ev.type === 'error') throw new LunexError(ev.message, 503)
        }
      }
      return { reply: reply.trim(), skill: done.skill, sources: done.sources || [], remainingToday: done.remaining_today }
    } catch (e) {
      if (e instanceof LunexError) throw e
      throw new LunexError(e.name === 'AbortError' ? 'LUNEX took too long. Please try again.' : 'Could not reach LUNEX. Check your connection.', 0)
    } finally { clearTimeout(timer) }
  }

  /** Wakes the (free) server if it is asleep, so the first real message is quicker. Never throws. */
  wake() { try { fetch(`${this.baseUrl}/health`, { cache: 'no-store' }).catch(() => {}) } catch { /* ignore */ } }

  async skills() {
    const res = await fetch(`${this.baseUrl}/v1/skills`, { headers: await this.#headers() })
    if (!res.ok) throw await LunexClient.#fail(res)
    return res.json()
  }
}

/** Your local LUNEX conversation [{role:'user'|'assistant', text}] -> what the server wants (last 12 turns). */
export const toHistory = (turns, max = 12) => (turns || []).slice(-max).map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: String(t.content ?? t.text ?? '').slice(0, 2000) }))

/** Messages from an open chat -> "Summarize this chat" context. nameOf(senderId) gives the display name. */
export const chatContext = (messages, nameOf, max = 150) => ({
  messages: messages.filter((m) => m.content && !m.deleted_at).slice(-max).map((m) => ({ author: nameOf(m.sender_id) || 'Someone', text: String(m.content).slice(0, 1000) })),
})
