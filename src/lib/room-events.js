// Typing indicator + "I read this" pings. These travel over a PRIVATE realtime channel
// (only members of the room may join it, enforced by the database) and are never stored.
import { supabase } from './supabase.js'

const TYPING_EVERY = 2500
export class RoomEvents {
  constructor({ onTyping, onRead, myId }) { this.onTyping = onTyping; this.onRead = onRead; this.myId = myId; this.channel = null; this.lastTyping = 0; this.roomId = null }

  join(roomId) {
    this.leave()
    this.roomId = roomId
    const ch = supabase.channel(`room:${roomId}`, { config: { private: true, broadcast: { self: false } } })
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => { if (payload?.uid && payload.uid !== this.myId) this.onTyping?.(roomId, payload.uid) })
      .on('broadcast', { event: 'read' }, ({ payload }) => { if (payload?.uid && payload.uid !== this.myId) this.onRead?.(roomId, payload.uid) })
      .subscribe((status) => { this.ready = status === 'SUBSCRIBED' })
    this.channel = ch
  }
  leave() {
    if (this.channel) { try { supabase.removeChannel(this.channel) } catch { /* ignore */ } }
    this.channel = null; this.ready = false; this.roomId = null
  }
  typing() {
    const now = Date.now()
    if (!typingEnabled() || !this.ready || now - this.lastTyping < TYPING_EVERY) return
    this.lastTyping = now
    this.channel.send({ type: 'broadcast', event: 'typing', payload: { uid: this.myId } }).catch(() => {})
  }
  read() { if (this.ready) this.channel.send({ type: 'broadcast', event: 'read', payload: { uid: this.myId } }).catch(() => {}) }
}

// "Show typing bubbles" preference (this browser only). Off = you neither send nor see typing.
const K_TYPING = 'lsdkchat.typing'
export const typingEnabled = () => { try { return localStorage.getItem(K_TYPING) !== 'off' } catch { return true } }
export const setTypingEnabled = (on) => { try { localStorage.setItem(K_TYPING, on ? 'on' : 'off') } catch { /* ignore */ } }
