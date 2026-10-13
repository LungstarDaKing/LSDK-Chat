// Nicknames: what I call someone. Only the two people involved can ever see a nickname.
// `mine` = nicknames I gave; `theirs` = nicknames others gave me (shown in their profile card).
import { supabase } from './supabase.js'

const mine = new Map(), theirs = new Map()
const listeners = new Set()
let channel = null, owner = null

export const nickOf = (id) => mine.get(id) || null
export const nickFor = (ownerId) => theirs.get(ownerId) || null          // what ownerId calls me
export const onNicknames = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = () => { for (const fn of listeners) { try { fn() } catch { /* ignore */ } } }

export async function loadNicknames(meId) {
  owner = meId
  const { data, error } = await supabase.from('nicknames').select('owner_id, target_id, nickname')
  if (error) return                                                         // v0.9 SQL not run yet: nicknames simply stay empty
  mine.clear(); theirs.clear()
  for (const r of data || []) (r.owner_id === meId ? mine.set(r.target_id, r.nickname) : theirs.set(r.owner_id, r.nickname))
  emit()
}

export function watchNicknames(meId) {
  if (channel) return
  channel = supabase.channel('nicknames-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'nicknames' }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new
    if (!row) return
    if (p.eventType === 'DELETE') { if (row.owner_id === meId) mine.delete(row.target_id); else theirs.delete(row.owner_id); loadNicknames(meId); return }
    if (row.owner_id === meId) mine.set(row.target_id, row.nickname)
    else if (row.target_id === meId) theirs.set(row.owner_id, row.nickname)
    emit()
  }).subscribe()
}
export function stopNicknames() { if (channel) supabase.removeChannel(channel); channel = null; mine.clear(); theirs.clear(); owner = null }

export async function setNickname(targetId, nick) {
  const n = (nick || '').trim().slice(0, 30)
  const { error } = await supabase.rpc('set_nickname', { p_target: targetId, p_nick: n })
  if (error) throw error
  if (n) mine.set(targetId, n); else mine.delete(targetId)
  emit()
  return n
}
