// Smart messaging tools: thin wrappers around the v0.7 database functions.
// Every rule (who may see/save/schedule what) is enforced by the database; this is just the plumbing.
import { supabase } from './supabase.js'

const ok = ({ data, error }) => { if (error) throw error; return data }

export const getNotesRoom = async () => ok(await supabase.rpc('get_notes_room'))
export const setMarkedUnread = async (room, value) => ok(await supabase.rpc('set_marked_unread', { p_room: room, p_value: !!value }))
export const loadMarkedUnread = async () => new Set((ok(await supabase.from('room_flags').select('room_id').eq('marked_unread', true)) || []).map((r) => r.room_id))

export const saveMessage = async (id, collection) => ok(await supabase.rpc('save_message', { p_message: id, p_collection: collection || 'Saved' }))
export const listSaved = async () => ok(await supabase.from('saved_items')
  .select('id, collection, created_at, messages(id, room_id, sender_id, content, created_at, attachment_name, attachment_type, attachment_path)')
  .order('created_at', { ascending: false }).limit(500)) || []
export const removeSaved = async (id) => ok(await supabase.from('saved_items').delete().eq('id', id))

export const setReminder = async (id, when) => ok(await supabase.rpc('set_reminder', { p_message: id, p_when: new Date(when).toISOString() }))
export const listReminders = async () => ok(await supabase.from('message_reminders')
  .select('id, remind_at, messages(id, room_id, sender_id, content, attachment_name, created_at)').order('remind_at')) || []
export const removeReminder = async (id) => ok(await supabase.from('message_reminders').delete().eq('id', id))

export const scheduleMessage = async ({ room, content, at, whenOnline, replyTo }) => ok(await supabase.rpc('schedule_message', {
  p_room: room, p_content: content, p_send_at: at ? new Date(at).toISOString() : null, p_when_online: !!whenOnline, p_reply_to: replyTo || null }))
export const listScheduled = async () => ok(await supabase.from('scheduled_messages')
  .select('id, room_id, content, send_at, when_online, status, error, created_at, sent_at').order('created_at', { ascending: false }).limit(100)) || []
export const removeScheduled = async (id) => ok(await supabase.from('scheduled_messages').delete().eq('id', id))

export const searchMessages = async (q, kind = 'text', before = null, limit = 40) =>
  ok(await supabase.rpc('search_messages', { p_q: q, p_kind: kind, p_before: before, p_limit: limit })) || []

// ---- reminder watcher: while the app is open, show reminders when they come due ----
let timer = null
export function startReminderWatcher(onDue) {
  stopReminderWatcher()
  const tick = async () => {
    try {
      const { data } = await supabase.from('message_reminders')
        .select('id, remind_at, messages(id, room_id, sender_id, content, attachment_name)')
        .lte('remind_at', new Date().toISOString()).order('remind_at').limit(5)
      for (const r of data || []) {
        const { error } = await supabase.from('message_reminders').delete().eq('id', r.id)   // fire once
        if (!error) onDue(r)
      }
    } catch { /* offline: try again next time */ }
  }
  setTimeout(tick, 1500)
  timer = setInterval(tick, 30000)
}
export function stopReminderWatcher() { if (timer) clearInterval(timer); timer = null }

// ---- small helpers shared by the screens ----
export const previewText = (m, max = 120) => {
  if (!m) return 'Message deleted'
  const t = (m.content || '').trim().replace(/\s+/g, ' ')
  const file = m.attachment_name ? (/^voice-note/.test(m.attachment_name) ? '🎤 Voice note' : `📎 ${m.attachment_name}`) : ''
  const s = [file, t].filter(Boolean).join(' ')
  return s.length > max ? s.slice(0, max - 1) + '…' : s || '(empty)'
}
// <input type="datetime-local"> wants local time without seconds.
export const toLocalInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
export const quickTimes = () => {
  const now = new Date(), at = (d, h2) => { const x = new Date(d); x.setHours(h2, 0, 0, 0); return x }
  const tomorrow = new Date(now.getTime() + 864e5)
  const list = [{ label: 'In 1 hour', date: new Date(now.getTime() + 36e5) }]
  if (now.getHours() < 17) list.push({ label: 'This evening (18:00)', date: at(now, 18) })
  list.push({ label: 'Tomorrow morning (08:00)', date: at(tomorrow, 8) })
  return list
}
