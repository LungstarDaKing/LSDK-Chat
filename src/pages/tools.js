// Tools: search everything, library of shared media/documents/links, saved messages,
// reminders and scheduled messages. All data is private to the signed-in person.
import { supabase } from '../lib/supabase.js'
import { h, clear, toast, confirmDialog, debounce, friendlyError } from '../lib/dom.js'
import { state, go } from '../lib/state.js'
import { fmtSize, signedUrls } from '../lib/media.js'
import { searchMessages, listSaved, removeSaved, listReminders, removeReminder, listScheduled, removeScheduled, previewText } from '../lib/tools.js'

const TABS = [['search', '🔎 Search'], ['library', '🗂 Library'], ['saved', '🔖 Saved'], ['reminders', '⏰ Reminders'], ['scheduled', '🗓 Scheduled']]
const fmtWhen = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const URL_RE = /https?:\/\/[^\s<>"')]+/gi
export const linksIn = (t) => [...new Set((t || '').match(URL_RE) || [])].map((u) => u.replace(/[.,;:!?]+$/, ''))
export const safeHref = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null } catch { return null } }

async function roomNames() {
  const me = state.session.user.id, map = new Map()
  const { data } = await supabase.from('rooms').select('id, name, is_direct, notes_owner, participants(profile_id, profiles(username))')
  for (const r of data || []) {
    map.set(r.id, r.notes_owner ? '📝 Notes to myself' : r.is_direct ? (r.participants.find((p) => p.profile_id !== me)?.profiles?.username || 'Direct chat') : r.name)
  }
  return map
}
const openIn = (roomId, msgId) => go(`#/chat/${roomId}${msgId ? '/' + msgId : ''}`)

export async function renderTools(root, tab = 'search') {
  if (!TABS.some(([id]) => id === tab)) tab = 'search'
  const names = await roomNames()
  const body = h('div', { class: 'tools-body' })
  const nav = h('nav', { class: 'seg wrap tools-tabs', 'aria-label': 'Tools' }, TABS.map(([id, label]) =>
    h('a', { href: `#/tools/${id}`, class: id === tab ? 'on' : '', 'aria-current': id === tab ? 'page' : null }, label)))
  clear(root).append(h('main', { class: 'doc wide' },
    h('p', {}, h('a', { href: '#/chat' }, '← Back to chats')),
    h('h1', {}, 'Tools'), nav, body))
  const room = (id) => names.get(id) || 'a chat'
  const empty = (t) => h('p', { class: 'small empty-note' }, t)
  const item = ({ title, sub, text, thumb, actions }) => h('li', { class: 'tool-item' },
    thumb, h('div', { class: 'tool-main' }, h('div', { class: 'tool-title' }, title), text && h('div', { class: 'tool-text' }, text), sub && h('div', { class: 'small' }, sub)),
    h('div', { class: 'tool-actions' }, actions))
  const btn = (label, fn, cls = 'btn small') => h('button', { type: 'button', class: cls, onclick: fn }, label)

  /* ---------- search ---------- */
  if (tab === 'search') {
    const q = h('input', { type: 'search', id: 'tq', placeholder: 'Search your messages, files and links', maxLength: 100, autocomplete: 'off', 'aria-label': 'Search' })
    const kinds = [['text', 'Messages'], ['files', 'Files'], ['links', 'Links']]
    let kind = 'text', before = null, seq = 0
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'What to search' })
    const out = h('ul', { class: 'tool-list', 'aria-live': 'polite' })
    const more = btn('Show more', () => run(true))
    more.hidden = true
    const hint = h('p', { class: 'small' }, 'Type at least 2 characters to search messages. Files and Links also work with an empty box (shows the latest).')
    const drawSeg = () => seg.replaceChildren(...kinds.map(([id, l]) => h('button', { type: 'button', role: 'radio', class: id === kind ? 'on' : '', 'aria-checked': String(id === kind), onclick: () => { kind = id; drawSeg(); run(false) } }, l)))
    const row = (m) => {
      const who = m.sender_id === state.session.user.id ? 'You' : null
      const links = kind === 'links' ? linksIn(m.content) : []
      return item({
        title: `${room(m.room_id)}${who ? '' : ''}`, sub: `${who ? 'You · ' : ''}${fmtWhen(m.created_at)}`,
        text: kind === 'files' ? previewText(m, 160) : kind === 'links' ? h('span', {}, links.map((u) => { const href = safeHref(u); return href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'tool-link' }, u) : u })) : previewText(m, 200),
        actions: btn('Open in chat', () => openIn(m.room_id, m.id)),
      })
    }
    const run = async (append) => {
      const my = ++seq
      const text = q.value.trim()
      if (!append) { out.replaceChildren(); before = null; more.hidden = true }
      if (kind === 'text' && text.length < 2) { hint.hidden = false; return }
      hint.hidden = true
      try {
        const rows = await searchMessages(text, kind, before)
        if (my !== seq) return
        if (!append && !rows.length) out.append(h('li', {}, empty('Nothing found.')))
        for (const m of rows) out.append(row(m))
        before = rows.at(-1)?.created_at || before
        more.hidden = rows.length < 40
      } catch (e) { if (my === seq) toast(friendlyError(e), 'error') }
    }
    q.addEventListener('input', debounce(() => run(false), 300))
    drawSeg()
    body.append(h('div', { class: 'field' }, h('label', { for: 'tq' }, 'Search'), q), seg, hint, out, more)
    q.focus()
    return
  }

  /* ---------- library ---------- */
  if (tab === 'library') {
    const cats = [['all', 'Everything'], ['image', 'Photos'], ['video', 'Videos'], ['voice', 'Voice notes'], ['audio', 'Music & audio'], ['doc', 'Documents'], ['link', 'Links']]
    const catOf = (m) => /^image\//.test(m.attachment_type || '') ? 'image' : /^video\//.test(m.attachment_type || '') ? 'video'
      : /^audio\//.test(m.attachment_type || '') ? (/^voice-note/.test(m.attachment_name || '') ? 'voice' : 'audio') : 'doc'
    let cat = 'all', chat = '', items = [], links = [], bF = null, bL = null, doneF = false, doneL = false, done = false, loading = false
    const seg = h('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'Type' })
    const sel = h('select', { 'aria-label': 'Chat' }, h('option', { value: '' }, 'All chats'), [...names].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => h('option', { value: id }, n)))
    const grid = h('ul', { class: 'tool-list lib' })
    const more = btn('Load older', () => load())
    const drawSeg = () => seg.replaceChildren(...cats.map(([id, l]) => h('button', { type: 'button', role: 'radio', class: id === cat ? 'on' : '', 'aria-checked': String(id === cat), onclick: () => { cat = id; drawSeg(); draw() } }, l)))
    const draw = async () => {
      grid.replaceChildren()
      const files = items.filter((m) => (!chat || m.room_id === chat) && (cat === 'all' || cat === catOf(m)))
      const lk = (cat === 'all' || cat === 'link') ? links.filter((l) => !chat || l.room_id === chat) : []
      const imgs = files.filter((m) => catOf(m) === 'image' && m.attachment_path)
      const urls = imgs.length ? await signedUrls('media', imgs.slice(0, 60).map((m) => m.attachment_path)) : new Map()
      for (const m of files) {
        const u = urls.get(m.attachment_path)
        grid.append(item({
          thumb: u ? h('img', { class: 'tool-thumb', src: u, alt: '', loading: 'lazy' }) : h('span', { class: 'tool-thumb icon', 'aria-hidden': 'true' }, { video: '🎬', voice: '🎤', audio: '🎵', doc: '📄', image: '🖼' }[catOf(m)]),
          title: m.attachment_name || 'File', sub: `${room(m.room_id)} · ${fmtWhen(m.created_at)}${m.attachment_size ? ' · ' + fmtSize(m.attachment_size) : ''}`,
          actions: btn('Open in chat', () => openIn(m.room_id, m.id)) }))
      }
      for (const l of lk) {
        const href = safeHref(l.url)
        grid.append(item({ thumb: h('span', { class: 'tool-thumb icon', 'aria-hidden': 'true' }, '🔗'),
          title: href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'tool-link' }, l.url) : l.url,
          sub: `${room(l.room_id)} · ${fmtWhen(l.created_at)}`, actions: btn('Open in chat', () => openIn(l.room_id, l.id)) }))
      }
      if (!grid.children.length) grid.append(h('li', {}, empty(done ? 'Nothing here.' : 'Nothing in the part loaded so far. Try "Load older".')))
      more.hidden = done
    }
    const load = async () => {
      if (loading) return
      loading = true; more.disabled = true
      try {
        const [f, l] = await Promise.all([doneF ? [] : searchMessages('', 'files', bF, 100), doneL ? [] : searchMessages('', 'links', bL, 100)])
        items.push(...f)
        for (const m of l) for (const url of linksIn(m.content)) links.push({ url, id: m.id, room_id: m.room_id, created_at: m.created_at })
        if (!doneF) { doneF = f.length < 100; bF = f.at(-1)?.created_at || bF }
        if (!doneL) { doneL = l.length < 100; bL = l.at(-1)?.created_at || bL }
        done = doneF && doneL
        await draw()
      } catch (e) { toast(friendlyError(e), 'error') } finally { loading = false; more.disabled = false }
    }
    sel.addEventListener('change', () => { chat = sel.value; draw() })
    drawSeg()
    body.append(h('p', { class: 'small' }, 'Photos, videos, voice notes, music, documents and links from all your chats, sorted automatically.'), seg, h('div', { class: 'field' }, h('label', {}, 'Chat'), sel), grid, more)
    await load()
    return
  }

  /* ---------- saved ---------- */
  if (tab === 'saved') {
    let rows = []
    const seg = h('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'Collections' })
    const list = h('ul', { class: 'tool-list' })
    let cur = ''
    const draw = () => {
      const cols = [...new Set(rows.map((r) => r.collection))].sort()
      seg.replaceChildren(...[['', 'All'], ...cols.map((c) => [c, c])].map(([id, l]) => h('button', { type: 'button', role: 'radio', class: id === cur ? 'on' : '', 'aria-checked': String(id === cur), onclick: () => { cur = id; draw() } }, l)))
      list.replaceChildren()
      const shown = rows.filter((r) => !cur || r.collection === cur)
      if (!shown.length) list.append(h('li', {}, empty('Nothing saved yet. Press and hold a message, then choose Save.')))
      for (const r of shown) {
        const m = r.messages
        list.append(item({ title: m ? room(m.room_id) : 'Message deleted', sub: `${r.collection} · saved ${fmtWhen(r.created_at)}`, text: previewText(m, 240),
          actions: [m && btn('Open in chat', () => openIn(m.room_id, m.id)), btn('Remove', async () => { try { await removeSaved(r.id); rows = rows.filter((x) => x.id !== r.id); draw() } catch (e) { toast(friendlyError(e), 'error') } })] }))
      }
    }
    try { rows = await listSaved() } catch (e) { toast(friendlyError(e), 'error') }
    body.append(h('p', { class: 'small' }, 'Messages you saved, grouped in collections. Only you can see this.'), seg, list); draw()
    return
  }

  /* ---------- reminders ---------- */
  if (tab === 'reminders') {
    const list = h('ul', { class: 'tool-list' })
    let rows = []
    const draw = () => {
      list.replaceChildren()
      if (!rows.length) list.append(h('li', {}, empty('No reminders. Press and hold a message, then choose "Remind me".')))
      for (const r of rows) {
        const m = r.messages
        list.append(item({ title: fmtWhen(r.remind_at), sub: m ? `in ${room(m.room_id)}` : '', text: previewText(m, 240),
          actions: [m && btn('Open in chat', () => openIn(m.room_id, m.id)), btn('Delete', async () => { try { await removeReminder(r.id); rows = rows.filter((x) => x.id !== r.id); draw() } catch (e) { toast(friendlyError(e), 'error') } })] }))
      }
    }
    try { rows = await listReminders() } catch (e) { toast(friendlyError(e), 'error') }
    body.append(h('p', { class: 'small' }, 'Reminders pop up while LSDK Chat is open in a browser tab. If it was closed, they show as soon as you open it again.'), list); draw()
    return
  }

  /* ---------- scheduled ---------- */
  let rows = []
  const list = h('ul', { class: 'tool-list' })
  const label = { pending: 'Waiting', sent: 'Sent', failed: 'Not sent', expired: 'Expired' }
  const draw = () => {
    list.replaceChildren()
    if (!rows.length) list.append(h('li', {}, empty('Nothing scheduled. In a chat, write a message and press 🗓 to send it later.')))
    for (const r of rows) {
      list.append(item({ title: `To ${room(r.room_id)}`, text: r.content,
        sub: `${label[r.status] || r.status} · ${r.when_online ? 'when they come online' : fmtWhen(r.send_at)}${r.error ? ' · ' + r.error : ''}`,
        actions: btn(r.status === 'pending' ? 'Cancel' : 'Remove', async () => { try { await removeScheduled(r.id); rows = rows.filter((x) => x.id !== r.id); draw() } catch (e) { toast(friendlyError(e), 'error') } }) }))
    }
  }
  try { rows = await listScheduled() } catch (e) { toast(friendlyError(e), 'error') }
  body.append(h('p', { class: 'small' }, 'Messages waiting to be sent. They go out on time even if the app is closed (the server sends them when anyone is online, usually within a minute). "When they come online" waits until that person is online and shares their online status.'), list); draw()
}
