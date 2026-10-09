import { supabase } from '../lib/supabase.js'
import { h, clear, toast, dialog, confirmDialog, debounce, friendlyError } from '../lib/dom.js'
import { CONFIG } from '../config.js'
import { state, go } from '../lib/state.js'

const PAGE = 50
const MAX_LEN = 1000

let chat = null
export function teardownChat() { if (chat) chat.destroy(); chat = null }
export function renderChat(root, roomId) {
  if (!chat || !root.contains(chat.el)) {
    teardownChat()
    chat = new Chat(root)
  }
  chat.open(roomId)
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c)
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()

class Chat {
  constructor(root) {
    this.me = state.profile
    this.rooms = []
    this.names = new Map([[this.me.id, this.me.username]])
    this.unread = new Set()
    this.currentId = null
    this.messages = []
    this.hasMore = false
    this.editingId = null
    this.channel = null
    this.wasDown = false
    this.loadToken = 0
    this.sending = false
    this.alive = true
    this.build(root)
    this.init()
  }

  /* ---------- DOM skeleton ---------- */
  build(root) {
    this.roomList = h('ul', { class: 'room-list', 'aria-label': 'Your chats' })
    this.banner = h('div', { class: 'banner', role: 'status', hidden: true }, 'Connection lost - reconnecting…')
    this.paneTitle = h('h2', { class: 'pane-title' })
    this.paneSub = h('div', { class: 'pane-sub' })
    this.infoBtn = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Room info', title: 'Room info', onclick: () => this.openInfo() }, 'ⓘ')
    this.messagesEl = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' })
    this.input = h('textarea', {
      class: 'composer-input', rows: 1, maxLength: MAX_LEN, placeholder: 'Write a message…', 'aria-label': 'Message',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send() } },
      oninput: () => { this.input.style.height = 'auto'; this.input.style.height = Math.min(this.input.scrollHeight, 140) + 'px'; this.counter.textContent = this.input.value.length > 800 ? `${this.input.value.length}/${MAX_LEN}` : '' },
    })
    this.counter = h('span', { class: 'counter' })
    this.sendBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => this.send() }, 'Send')
    this.composer = h('div', { class: 'composer' }, this.input, this.counter, this.sendBtn)
    this.empty = h('div', { class: 'empty' }, h('p', {}, 'Select a chat, or start a new one.'))
    this.pane = h('section', { class: 'pane' },
      h('header', { class: 'pane-head' },
        h('button', { class: 'btn icon back', type: 'button', 'aria-label': 'Back to chats', onclick: () => go('#/chat') }, '←'),
        h('div', { class: 'pane-titles' }, this.paneTitle, this.paneSub), this.infoBtn),
      this.messagesEl, this.composer)

    this.el = h('div', { class: 'chat' },
      h('aside', { class: 'sidebar' },
        h('header', { class: 'side-head' },
          h('strong', { class: 'app-name' }, CONFIG.appName),
          h('div', { class: 'row tight' },
            h('button', { class: 'btn icon', type: 'button', title: 'New direct chat', 'aria-label': 'New direct chat', onclick: () => this.newDirect() }, '✎'),
            h('button', { class: 'btn icon', type: 'button', title: 'New group', 'aria-label': 'New group', onclick: () => this.newGroup() }, '👥'),
            h('a', { class: 'btn icon', href: '#/profile', title: 'Profile', 'aria-label': 'Profile' }, '👤'))),
        this.banner,
        this.roomList,
        h('footer', { class: 'side-foot' }, h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms'), ' · ',
          h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy'), ' · ',
          h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'Disclosures'))),
      this.empty, this.pane)
    clear(root).append(this.el)
    this.setPaneVisible(false)
  }

  setPaneVisible(on) {
    this.pane.hidden = !on
    this.empty.hidden = on
    this.el.classList.toggle('show-pane', on)
  }

  /* ---------- lifecycle ---------- */
  async init() {
    await this.loadRooms()
    this.subscribe()
    this.poll = setInterval(() => document.visibilityState === 'visible' && this.loadRooms(), 30000)
    this.onVis = () => { if (document.visibilityState === 'visible') this.loadRooms() }
    document.addEventListener('visibilitychange', this.onVis)
  }

  destroy() {
    this.alive = false
    clearInterval(this.poll)
    document.removeEventListener('visibilitychange', this.onVis)
    if (this.channel) supabase.removeChannel(this.channel)
  }

  subscribe() {
    this.channel = supabase.channel('messages-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => this.onInsert(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => this.onUpdate(p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => this.onDelete(p.old?.id))
      .subscribe((status) => {
        if (!this.alive) return
        if (status === 'SUBSCRIBED') {
          this.banner.hidden = true
          if (this.wasDown) { this.wasDown = false; this.loadRooms(); if (this.currentId) this.loadMessages(true) }
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          this.wasDown = true; this.banner.hidden = false
        }
      })
  }

  /* ---------- rooms ---------- */
  async loadRooms() {
    const { data, error } = await supabase.from('rooms')
      .select('id, name, is_direct, last_message_at, participants(profile_id, role, joined_at, profiles(username))')
      .order('last_message_at', { ascending: false })
    if (!this.alive) return
    if (error) { toast(friendlyError(error), 'error'); return }
    this.rooms = data
    for (const r of data) for (const p of r.participants) if (p.profiles) this.names.set(p.profile_id, p.profiles.username)
    this.renderRooms()
    if (this.currentId) {
      const r = this.room()
      if (!r) { this.currentId = null; this.setPaneVisible(false); go('#/chat'); toast('That chat is no longer available.') }
      else this.renderHeader()
    }
  }

  room(id = this.currentId) { return this.rooms.find((r) => r.id === id) }
  nameOf(id) { return this.names.get(id) || 'Former member' }
  title(r) {
    if (!r.is_direct) return r.name
    const other = r.participants.find((p) => p.profile_id !== this.me.id)
    return other?.profiles?.username || 'Direct chat'
  }
  myRole(r) { return r?.participants.find((p) => p.profile_id === this.me.id)?.role }

  renderRooms() {
    clear(this.roomList)
    if (!this.rooms.length) {
      this.roomList.append(h('li', { class: 'room-empty' }, 'No chats yet. Use ✎ to message someone or 👥 to create a group.'))
      return
    }
    for (const r of this.rooms) {
      const unread = this.unread.has(r.id)
      this.roomList.append(h('li', {},
        h('a', { class: `room-item${r.id === this.currentId ? ' active' : ''}${unread ? ' unread' : ''}`, href: `#/chat/${r.id}`, 'aria-current': r.id === this.currentId ? 'true' : null },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, (this.title(r) || '?').slice(0, 1).toUpperCase()),
          h('span', { class: 'room-meta' },
            h('span', { class: 'room-name' }, this.title(r)),
            h('span', { class: 'room-sub' }, r.is_direct ? 'Direct chat' : `${r.participants.length} members`)),
          unread && h('span', { class: 'dot', 'aria-label': 'New messages' }))))
    }
  }

  renderHeader() {
    const r = this.room()
    if (!r) return
    this.paneTitle.textContent = this.title(r)
    this.paneSub.textContent = r.is_direct ? 'Direct chat' : r.participants.map((p) => this.nameOf(p.profile_id)).join(', ')
  }

  /* ---------- open a room ---------- */
  async open(roomId) {
    if (!roomId) {
      this.currentId = null; this.messages = []; this.setPaneVisible(false); this.renderRooms(); return
    }
    if (roomId === this.currentId) { this.setPaneVisible(true); return }
    if (!this.room(roomId)) {
      await this.loadRooms()
      if (!this.room(roomId)) { toast('Chat not found.', 'error'); return go('#/chat') }
    }
    this.currentId = roomId
    this.unread.delete(roomId)
    this.editingId = null
    this.messages = []
    this.hasMore = false
    this.renderRooms(); this.renderHeader(); this.setPaneVisible(true)
    this.renderMessages(true)
    await this.loadMessages(true)
    this.input.focus({ preventScroll: true })
  }

  async loadMessages(scrollDown) {
    const id = this.currentId, token = ++this.loadToken
    const { data, error } = await supabase.from('messages')
      .select('id, room_id, sender_id, content, created_at, edited_at')
      .eq('room_id', id).order('created_at', { ascending: false }).limit(PAGE)
    if (token !== this.loadToken || !this.alive) return
    if (error) return toast(friendlyError(error), 'error')
    this.messages = data.reverse()
    this.hasMore = data.length === PAGE
    await this.ensureNames(this.messages.map((m) => m.sender_id))
    if (token !== this.loadToken) return
    this.renderMessages(scrollDown)
  }

  async loadOlder() {
    const first = this.messages[0]; if (!first) return
    const id = this.currentId
    const { data, error } = await supabase.from('messages')
      .select('id, room_id, sender_id, content, created_at, edited_at')
      .eq('room_id', id).lt('created_at', first.created_at).order('created_at', { ascending: false }).limit(PAGE)
    if (error) return toast(friendlyError(error), 'error')
    if (id !== this.currentId) return
    this.hasMore = data.length === PAGE
    this.messages = data.reverse().concat(this.messages)
    await this.ensureNames(data.map((m) => m.sender_id))
    const el = this.messagesEl, prev = el.scrollHeight
    this.renderMessages(false)
    el.scrollTop = el.scrollHeight - prev
  }

  async ensureNames(ids) {
    const missing = [...new Set(ids)].filter((i) => !this.names.has(i))
    if (!missing.length) return
    const { data } = await supabase.from('profiles').select('id, username').in('id', missing)
    for (const p of data || []) this.names.set(p.id, p.username)
  }

  /* ---------- rendering messages ---------- */
  renderMessages(scrollDown) {
    const el = this.messagesEl
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    clear(el)
    if (this.hasMore) el.append(h('button', { class: 'btn small center', type: 'button', onclick: () => this.loadOlder() }, 'Load earlier messages'))
    if (!this.messages.length && !this.hasMore) el.append(h('p', { class: 'hint' }, 'No messages yet. Say hello!'))
    const r = this.room(); const iAmAdmin = this.myRole(r) === 'admin'
    let prev = null
    for (const m of this.messages) {
      if (!prev || !sameDay(prev.created_at, m.created_at)) el.append(h('div', { class: 'day' }, fmtDay(m.created_at)))
      el.append(this.messageEl(m, m.sender_id === this.me.id, iAmAdmin, prev && prev.sender_id === m.sender_id && sameDay(prev.created_at, m.created_at)))
      prev = m
    }
    if (scrollDown || nearBottom) el.scrollTop = el.scrollHeight
  }

  messageEl(m, own, iAmAdmin, grouped) {
    const editing = this.editingId === m.id
    let body
    if (editing) {
      const ta = h('textarea', { class: 'edit-input', maxLength: MAX_LEN, rows: 2, 'aria-label': 'Edit message' }, '')
      ta.value = m.content
      const save = async () => {
        const v = ta.value.trim()
        if (!v) return toast('Message cannot be empty.', 'error')
        if (v !== m.content) {
          const { data, error } = await supabase.from('messages').update({ content: v }).eq('id', m.id).select().maybeSingle()
          if (error || !data) return toast(error ? friendlyError(error) : 'Could not edit that message.', 'error')
          this.onUpdate(data)
        }
        this.editingId = null; this.renderMessages(false)
      }
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save() }
        if (e.key === 'Escape') { this.editingId = null; this.renderMessages(false) }
      })
      body = [ta, h('div', { class: 'row tight' },
        h('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Save'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { this.editingId = null; this.renderMessages(false) } }, 'Cancel'))]
      setTimeout(() => ta.focus(), 0)
    } else {
      body = h('div', { class: 'text' }, m.content)       // textContent only: safe against HTML injection
    }
    const actions = editing ? null : h('div', { class: 'msg-actions' },
      own && h('button', { class: 'linkish', type: 'button', onclick: () => { this.editingId = m.id; this.renderMessages(false) } }, 'Edit'),
      (own || iAmAdmin) && h('button', { class: 'linkish', type: 'button', onclick: () => this.deleteMessage(m) }, 'Delete'),
      !own && h('button', { class: 'linkish', type: 'button', onclick: () => this.reportMessage(m) }, 'Report'))
    return h('div', { class: `msg-row ${own ? 'own' : 'other'}${grouped ? ' grouped' : ''}`, dataset: { id: m.id } },
      h('div', { class: 'bubble' },
        !grouped && h('div', { class: 'meta' }, own ? 'You' : this.nameOf(m.sender_id)),
        body,
        h('div', { class: 'foot' }, fmtTime(m.created_at), m.edited_at && ' · edited'),
        actions))
  }

  /* ---------- realtime handlers ---------- */
  async onInsert(m) {
    if (!m) return
    const r = this.room(m.room_id)
    if (!r) { this.loadRooms(); if (m.room_id !== this.currentId) this.unread.add(m.room_id); return }
    r.last_message_at = m.created_at
    this.rooms.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
    if (m.room_id === this.currentId) {
      if (this.messages.some((x) => x.id === m.id)) return
      await this.ensureNames([m.sender_id])
      this.messages.push(m)
      this.renderMessages(m.sender_id === this.me.id)
    } else if (m.sender_id !== this.me.id) this.unread.add(m.room_id)
    this.renderRooms()
  }
  onUpdate(m) {
    const i = this.messages.findIndex((x) => x.id === m?.id)
    if (i >= 0) { this.messages[i] = { ...this.messages[i], ...m }; if (this.editingId !== m.id) this.renderMessages(false) }
  }
  onDelete(id) {
    if (!id) return
    const n = this.messages.length
    this.messages = this.messages.filter((x) => x.id !== id)
    if (this.messages.length !== n) this.renderMessages(false)
  }

  /* ---------- actions ---------- */
  async send() {
    if (this.sending || !this.currentId) return
    const content = this.input.value.trim()
    if (!content) return
    if (content.length > MAX_LEN) return toast(`Messages are limited to ${MAX_LEN} characters.`, 'error')
    this.sending = true; this.sendBtn.disabled = true
    const { data, error } = await supabase.from('messages')
      .insert({ room_id: this.currentId, sender_id: this.me.id, content }).select().single()
    this.sending = false; this.sendBtn.disabled = false
    if (error) return toast(friendlyError(error), 'error')
    this.input.value = ''; this.input.style.height = 'auto'; this.counter.textContent = ''
    this.onInsert(data)
    this.input.focus()
  }

  async deleteMessage(m) {
    if (!(await confirmDialog('Delete message?', 'This removes it for everyone in the room.', 'Delete', true))) return
    const { error } = await supabase.from('messages').delete().eq('id', m.id)
    if (error) return toast(friendlyError(error), 'error')
    this.onDelete(m.id)
  }

  reportMessage(m) {
    const reason = h('textarea', { rows: 3, maxLength: 500, 'aria-label': 'Reason', placeholder: 'What is wrong with this message?' })
    const err = h('div', { class: 'msg error', role: 'alert' })
    dialog({
      title: 'Report message',
      body: [h('p', { class: 'small' }, 'The operator will receive this message and your reason. The sender is not told who reported it.'),
        h('blockquote', {}, m.content.slice(0, 300)), reason, err],
      actions: [{ label: 'Cancel' }, { label: 'Send report', kind: 'primary', onClick: async () => {
        if (!reason.value.trim()) { err.textContent = 'Please describe the problem.'; return 'keep-open' }
        const { error } = await supabase.rpc('report_message', { p_message: m.id, p_reason: reason.value.trim() })
        if (error) { err.textContent = friendlyError(error); return 'keep-open' }
        toast('Report sent. Thank you.', 'success')
      } }],
    })
  }

  /* ---------- people pickers & dialogs ---------- */
  userPicker({ exclude = [], onPick, label = 'Search by username' }) {
    const input = h('input', { type: 'search', placeholder: label, 'aria-label': label, autocomplete: 'off', maxLength: 20 })
    const list = h('ul', { class: 'picker' })
    const hint = h('p', { class: 'small' }, 'Type at least 2 characters.')
    let seq = 0
    const run = debounce(async () => {
      const q = input.value.trim(), my = ++seq
      clear(list)
      if (q.length < 2) { hint.textContent = 'Type at least 2 characters.'; return }
      const { data, error } = await supabase.from('profiles').select('id, username')
        .ilike('username', `%${escapeLike(q)}%`).neq('id', this.me.id).order('username').limit(20)
      if (my !== seq) return
      if (error) { hint.textContent = friendlyError(error); return }
      const rows = data.filter((u) => !exclude.includes(u.id))
      hint.textContent = rows.length ? '' : 'No users found.'
      for (const u of rows) {
        this.names.set(u.id, u.username)
        list.append(h('li', {}, h('button', { type: 'button', class: 'pick', onclick: () => onPick(u) }, u.username)))
      }
    }, 250)
    input.addEventListener('input', run)
    return { el: h('div', {}, input, hint, list), input }
  }

  newDirect() {
    let d
    const picker = this.userPicker({ onPick: async (u) => {
      const { data, error } = await supabase.rpc('create_direct_room', { other_user_id: u.id })
      if (error) return toast(friendlyError(error), 'error')
      d.close(); await this.loadRooms(); go(`#/chat/${data}`)
    } })
    d = dialog({ title: 'New direct chat', body: picker.el, actions: [{ label: 'Cancel' }] })
    picker.input.focus()
  }

  newGroup() {
    const chosen = new Map()
    const name = h('input', { type: 'text', maxLength: 60, placeholder: 'Group name', 'aria-label': 'Group name' })
    const chips = h('div', { class: 'chips' })
    const err = h('div', { class: 'msg error', role: 'alert' })
    const drawChips = () => { clear(chips); for (const u of chosen.values()) chips.append(h('button', { type: 'button', class: 'chip', title: 'Remove', onclick: () => { chosen.delete(u.id); drawChips() } }, u.username, ' ✕')) }
    const picker = this.userPicker({ label: 'Add people by username', onPick: (u) => { chosen.set(u.id, u); drawChips() } })
    dialog({
      title: 'New group',
      body: [name, chips, picker.el, h('p', { class: 'small' }, 'People you add are put in the group without being asked first (they can leave at any time). Only add people who expect it.'), err],
      actions: [{ label: 'Cancel' }, { label: 'Create group', kind: 'primary', onClick: async () => {
        if (!name.value.trim()) { err.textContent = 'Give the group a name.'; return 'keep-open' }
        const { data, error } = await supabase.rpc('create_group_room', { room_name: name.value.trim(), member_ids: [...chosen.keys()] })
        if (error) { err.textContent = friendlyError(error); return 'keep-open' }
        await this.loadRooms(); go(`#/chat/${data}`)
      } }],
    })
  }

  openInfo() {
    const r0 = this.room(); if (!r0) return
    const body = h('div', {})
    const rid = r0.id
    let d
    const rpc = async (fn, args, ok) => {
      const { error } = await supabase.rpc(fn, args)
      if (error) return toast(friendlyError(error), 'error')
      if (ok) toast(ok, 'success')
      await this.loadRooms(); draw()
    }
    const draw = () => {
      const r = this.room(rid); if (!r) { d?.close(); return }
      const admin = this.myRole(r) === 'admin' && !r.is_direct
      clear(body)
      if (admin) {
        const rn = h('input', { type: 'text', value: r.name, maxLength: 60, 'aria-label': 'Room name' })
        body.append(h('div', { class: 'row' }, rn, h('button', { class: 'btn', type: 'button', onclick: () => rpc('rename_room', { p_room: rid, new_name: rn.value }, 'Renamed') }, 'Rename')))
      }
      body.append(h('h3', {}, `Members (${r.participants.length})`))
      const ul = h('ul', { class: 'members' })
      for (const p of r.participants) {
        const self = p.profile_id === this.me.id
        ul.append(h('li', {},
          h('span', {}, this.nameOf(p.profile_id), self ? ' (you)' : '', p.role === 'admin' && !r.is_direct ? h('em', { class: 'badge' }, 'admin') : ''),
          admin && !self && h('span', { class: 'row tight' },
            h('button', { class: 'linkish', type: 'button', onclick: () => rpc('set_member_role', { p_room: rid, p_user: p.profile_id, new_role: p.role === 'admin' ? 'member' : 'admin' }) }, p.role === 'admin' ? 'Make member' : 'Make admin'),
            h('button', { class: 'linkish', type: 'button', onclick: async () => { if (await confirmDialog('Remove member?', `Remove ${this.nameOf(p.profile_id)} from this group?`, 'Remove', true)) rpc('remove_room_member', { p_room: rid, p_user: p.profile_id }) } }, 'Remove'))))
      }
      body.append(ul)
      if (admin) {
        body.append(h('h3', {}, 'Add someone'), this.userPicker({ exclude: r.participants.map((p) => p.profile_id), onPick: (u) => rpc('add_room_member', { p_room: rid, p_user: u.id }, `${u.username} added`) }).el)
      }
      if (!r.is_direct) {
        body.append(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Leave this group?', 'You will stop receiving messages from it.', 'Leave', true))) return
          const { error } = await supabase.rpc('leave_room', { p_room: rid })
          if (error) return toast(friendlyError(error), 'error')
          d.close(); this.currentId = null; await this.loadRooms(); go('#/chat')
        } }, 'Leave group'))
      } else body.append(h('p', { class: 'small' }, 'Direct chats cannot be left. To stop receiving messages, report the message or contact the operator.'))
    }
    d = dialog({ title: r0.is_direct ? `Chat with ${this.title(r0)}` : r0.name, body, wide: true, actions: [{ label: 'Close' }] })
    draw()
  }
}
