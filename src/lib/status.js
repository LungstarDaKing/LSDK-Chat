// Online / last-seen. The hide settings are enforced by the database function get_statuses();
// this file just sends the "I'm here" ping and asks for the statuses you are allowed to see.
import { supabase } from './supabase.js'

let timer = null
let onVis = null
const ping = () => { if (document.visibilityState === 'visible') supabase.rpc('heartbeat').then(() => {}, () => {}) }

export function startHeartbeat() {
  if (timer) return
  ping()
  timer = setInterval(ping, 60000)
  onVis = () => ping()
  document.addEventListener('visibilitychange', onVis)
}
export function stopHeartbeat() {
  clearInterval(timer); timer = null
  if (onVis) document.removeEventListener('visibilitychange', onVis); onVis = null
}

// -> Map(profileId -> { online: boolean, lastSeen: string|null })  (people who hide are simply absent)
export async function fetchStatuses(ids) {
  const out = new Map()
  const list = [...new Set(ids)].slice(0, 100)
  if (!list.length) return out
  const { data, error } = await supabase.rpc('get_statuses', { p_ids: list })
  if (error) return out
  for (const r of data || []) out.set(r.id, { online: !!r.online, lastSeen: r.last_seen_at })
  return out
}

export function describeStatus(s) {
  if (!s) return ''
  if (s.online) return 'Online'
  if (!s.lastSeen) return ''
  const mins = Math.max(1, Math.round((Date.now() - new Date(s.lastSeen).getTime()) / 60000))
  if (mins < 60) return `Last seen ${mins} min ago`
  const d = new Date(s.lastSeen)
  const today = new Date().toDateString() === d.toDateString()
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return today ? `Last seen today at ${t}` : `Last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${t}`
}
