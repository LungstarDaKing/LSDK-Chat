// Supabase Edge Function "push": turns "a message / call happened" into alerts on people's devices (Web Push).
// Called only by the database triggers in update-v0.14-push.sql, with the shared secret in the Authorization header.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SECRET = Deno.env.get('PUSH_SECRET') ?? ''
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

type Alert = { title: string; body: string; tag: string; hash: string; kind: string }
const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }
const label = (t?: string | null) => (!t ? '' : t.startsWith('image') ? '📷 Photo' : t.startsWith('audio') ? '🎤 Voice message' : t.startsWith('video') ? '🎥 Video' : '📎 File')
const nameOf = async (id: string) => (await db.from('profiles').select('username').eq('id', id).maybeSingle()).data?.username ?? 'Someone'

// returns who should be alerted and what to show (with the full text; hidden later for people who chose "hide text")
async function build(p: any): Promise<{ to: string[]; alert: Alert } | null> {
  if (p.kind === 'message') {
    const { data: m } = await db.from('messages').select('id, room_id, sender_id, content, attachment_type').eq('id', p.id).maybeSingle()
    if (!m) return null
    const [{ data: room }, { data: parts }, who] = await Promise.all([
      db.from('rooms').select('id, name, is_direct').eq('id', m.room_id).maybeSingle(),
      db.from('participants').select('profile_id').eq('room_id', m.room_id),
      nameOf(m.sender_id),
    ])
    const to = (parts ?? []).map((x: any) => x.profile_id).filter((id: string) => id !== m.sender_id)
    const text = clip(m.content && m.content.trim() ? m.content : label(m.attachment_type) || 'New message')
    const direct = !!room?.is_direct
    return { to, alert: { kind: 'message', title: direct ? who : (room?.name ?? 'Group chat'), body: direct ? text : `${who}: ${text}`, tag: `room-${m.room_id}`, hash: `#/chat/${m.room_id}` } }
  }
  if (p.kind === 'call' || p.kind === 'missed_call') {
    const { data: c } = await db.from('calls').select('id, caller_id, callee_id, room_id, kind').eq('id', p.id).maybeSingle()
    if (!c) return null
    const who = await nameOf(c.caller_id)
    const hash = c.room_id ? `#/chat/${c.room_id}` : '#/chat'
    const video = c.kind === 'video'
    return p.kind === 'call'
      ? { to: [c.callee_id], alert: { kind: 'call', title: `${who} is calling`, body: `Incoming ${video ? 'video' : 'voice'} call. Tap to answer.`, tag: `call-${c.id}`, hash } }
      : { to: [c.callee_id], alert: { kind: 'missed_call', title: 'Missed call', body: `${who} called you (${video ? 'video' : 'voice'}).`, tag: `call-${c.id}`, hash } }
  }
  if (p.kind === 'group_call') {
    const { data: g } = await db.from('group_calls').select('id, room_id, started_by, kind, ended_at').eq('id', p.call_id).maybeSingle()
    if (!g || g.ended_at || g.started_by === p.profile_id) return null
    const [who, { data: room }] = await Promise.all([nameOf(g.started_by), db.from('rooms').select('name').eq('id', g.room_id).maybeSingle()])
    return { to: [p.profile_id], alert: { kind: 'group_call', title: `${who} started a group call`, body: `${room?.name ? room.name + ' · ' : ''}${g.kind === 'video' ? 'Video' : 'Voice'} call. Tap to join.`, tag: `gcall-${g.id}`, hash: `#/chat/${g.room_id}` } }
  }
  return null
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!SECRET || !same(auth, `Bearer ${SECRET}`)) return new Response('Forbidden', { status: 403 })
  let payload: any
  try { payload = await req.json() } catch { return new Response('Bad request', { status: 400 }) }
  const built = await build(payload)
  if (!built || !built.to.length) return new Response('nothing to send')
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth, show_preview').in('profile_id', built.to)
  const dead: string[] = []
  const urgent = built.alert.kind === 'call' || built.alert.kind === 'group_call'
  await Promise.all((subs ?? []).map(async (s: any) => {
    const a = built.alert
    const hide = !s.show_preview && a.kind === 'message'
    const body = JSON.stringify({ ...a, body: hide ? 'New message' : a.body, title: hide ? 'LSDK Chat' : a.title, ts: Date.now() })
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: urgent ? 45 : 86400, urgency: urgent ? 'high' : 'normal' })
    } catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id) }
  }))
  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead)
  return new Response(`sent ${(subs ?? []).length - dead.length}`)
})
