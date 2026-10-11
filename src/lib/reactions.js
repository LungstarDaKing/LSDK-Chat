import { supabase } from './supabase.js'

// -> toggles: same emoji again removes your reaction. Returns the emoji now set, or null.
export async function reactToMessage(messageId, emoji) {
  const { data, error } = await supabase.rpc('react_to_message', { p_message: messageId, p_emoji: emoji })
  if (error) throw error
  return data
}

// -> Map(messageId -> Map(userId -> emoji)) for one room
export async function loadReactions(roomId) {
  const out = new Map()
  const { data, error } = await supabase.from('message_reactions').select('message_id, user_id, emoji').eq('room_id', roomId).limit(5000)
  if (error) return out
  for (const r of data || []) setReaction(out, r.message_id, r.user_id, r.emoji)
  return out
}
export function setReaction(map, mid, uid, emoji) {
  if (!map.has(mid)) map.set(mid, new Map())
  if (emoji) map.get(mid).set(uid, emoji); else { map.get(mid)?.delete(uid); if (!map.get(mid)?.size) map.delete(mid) }
}
// -> [{ emoji, count, users: [uid...] }] most used first
export function summarize(byUser) {
  const g = new Map()
  for (const [uid, e] of byUser || []) { if (!g.has(e)) g.set(e, []); g.get(e).push(uid) }
  return [...g.entries()].map(([emoji, users]) => ({ emoji, count: users.length, users })).sort((a, b) => b.count - a.count)
}
