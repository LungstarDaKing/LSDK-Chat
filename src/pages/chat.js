import { supabase } from '../lib/supabase.js'
import { h, clear, toast, dialog, confirmDialog, debounce, friendlyError } from '../lib/dom.js'
import { CONFIG } from '../config.js'
import { state, go } from '../lib/state.js'
import { ACCEPT, kind, fmtSize, uploadAttachment, removeFiles, signedUrls, signedUrl, listFiles, resolveType } from '../lib/media.js'
import { fetchStatuses, describeStatus } from '../lib/status.js'

const PAGE = 50
const MAX_LEN = 1000
const MSG_COLS = 'id, room_id, sender_id, content, created_at, edited_at, attachment_path, attachment_name, attachment_type, attachment_size'

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
    this.people = new Map([[this.me.id, { username: this.me.username, avatar_path: this.me.avatar_path, bio: this.me.bio }]])
    this.status = new Map()
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
    this.stick = true
    this.build(root)
    this.init()
  }

  /* ---------- DOM skeleton ---------- */
  build(root) {
    this.roomList = h('ul', { class: 'room-list', 'aria-label': 'Your chats' })
    this.banner = h('div', { class: 'banner', role: 'status', hidden: true }, 'Connection lost - reconnecting…')
    this.paneTitle = h('h2', { class: 'pane-title' })
    this.paneSub = h('div', { class: 'pane-sub' })
    this.paneAvatar = h('span', { class: 'avatar sm' })
    this.infoBtn = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Chat info', title: 'Chat info', onclick: () => this.openInfo() }, 'ⓘ')
    this.messagesEl = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' })
    this.fileInput = h('input', { type: 'file', accept: ACCEPT, hidden: true, 'aria-label': 'Choose a file to send',
      onchange: () => { const f = this.fileInput.files[0]; this.fileInput.value = ''; if (f) this.askSendFile(f) } })
    this.attachBtn = h('button', { class: 'btn icon', type: 'button', title: 'Send a photo, video, audio or PDF', 'aria-label': 'Attach a file', onclick: () => this.fileInput.click() }, '📎')
    this.input = h('textarea', {
      class: 'composer-input', rows: 1, maxLength: MAX_LEN, placeholder: 'Write a message…', 'aria-label': 'Message',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send() } },
      oninput: () => { this.input.style.height = 'auto'; this.input.style.height = Math.min(this.input.scrollHeight, 140) + 'px'; this.counter.textContent = this.input.value.length > 800 ? `${this.input.value.length}/${MAX_LEN}` : '' },
      onpaste: (e) => {
        const f = [...(e.clipboardData?.files || [])][0]
        if (f) { e.preventDefault(); this.askSendFile(f) }
      },
    })
    this.counter = h('span', { class: 'counter' })
    this.sendBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => this.send() }, 'Send')
    this.composer = h('div', { class: 'composer' }, this.attachBtn, this.fileInput, this.input, this.counter, this.sendBtn)
    this.empty = h('div', { class: 'empty' }, h('p', {}, 'Select a chat, or start a new one.'))
    this.pane = h('section', { class: 'pane' },
      h('header', { class: 'pane-head' },
        h('button', { class: 'btn icon back', type: 'button', 'aria-label': 'Back to chats', onclick: () => go('#/chat') }, '←'),
        this.paneAvatar,
        h('div', { class: 'pane-titles' }, this.paneTitle, this.paneSub), this.infoBtn),
      this.messagesEl, this.composer)
    // drag & drop a file onto the conversation
    this.pane.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() })
    this.pane.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0]
      if (f) { e.preventDefault(); this.askSendFile(f) }
    })

    this.el = h('div', { class: 'chat' },
      h('aside', { class: 'sidebar' },
        h('header', { class: 'side-head' },
          h('strong', { class: 'app-name' }, CONFIG.appName),
          h('div', { class: 'row tight' },
            h('button', { class: 'btn icon', type: 'button', title: 'New direct chat', 'aria-label': 'New direct chat', onclick: () => this.newDirect() }, '✎'),
            h('button', { class: 'btn icon', type: 'button', title: 'New group', 'aria-label': 'New group', onclick: () => this.newGroup() }, '👥'),
            h('a', { class: 'btn icon', href: '#/profile', title: 'My profile', 'aria-label': 'My profile' }, this.avatar(this.me.id, 'xs')))),
        this.banner,
        this.roomList,
        h('footer', { class: 'side-foot' }, h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms'), ' · ',
          h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy'), ' · ',
          h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'Disclosures'))),
      this.empty, this.pane)
    clear(root).append(this.el)
    this.setPaneVisible(false)
    this.hydrateAvatars(this.el)
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
    const tick = () => { if (document.visibilityState === 'visible') { this.loadRooms() } }
    this.poll = setInterval(tick, 30000)
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

  /* ---------- people, avatars, status ---------- */
  nameOf(id) { return this.people.get(id)?.username || 'Former member' }

  // A round avatar: the first letter now, the picture as soon as its temporary link is ready.
  avatar(id, size = '') {
    const p = this.people.get(id)
    const el = h('span', { class: `avatar ${size}`, 'aria-hidden': 'true', dataset: p?.avatar_path ? { avatar: p.avatar_path } : {} }, (p?.username || '?').slice(0, 1).toUpperCase())
    return el
  }
  async hydrateAvatars(scope) {
    const els = [...scope.querySelectorAll('[data-avatar]')]
    if (!els.length) return
    const urls = await signedUrls('avatars', els.map((e) => e.dataset.avatar))
    if (!this.alive) return
    for (const el of els) {
      const url = urls.get(el.dataset.avatar)
      if (!url || el.querySelector('img')) continue
      const img = h('img', { src: url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
      img.addEventListener('load', () => { el.textContent = ''; el.append(img) }, { once: true })
    }
  }
  dot(id) { return this.status.get(id)?.online ? h('span', { class: 'online-dot', title: 'Online', 'aria-label': 'Online' }) : null }

  async ensurePeople(ids) {
    const missing = [...new Set(ids)].filter((i) => !this.people.has(i))
    if (!missing.length) return
    const { data } = await supabase.from('profiles').select('id, username, avatar_path, bio').in('id', missing)
    for (const p of data || []) this.people.set(p.id, p)
  }

  async refreshStatuses() {
    const ids = []
    for (const r of this.rooms) {
      if (r.is_direct) ids.push(...r.participants.map((p) => p.profile_id).filter((i) => i !== this.me.id))
      else if (r.id === this.currentId) ids.push(...r.participants.map((p) => p.profile_id).filter((i) => i !== this.me.id))
    }
    const next = await fetchStatuses(ids)
    if (!this.alive) return
    this.status = next
    this.renderRooms()
    if (this.currentId) this.renderHeader()
  }

  /* ---------- rooms ---------- */
  async loadRooms() {
    const { data, error } = await supabase.from('rooms')
      .select('id, name, is_direct, last_message_at, participants(profile_id, role, joined_at, profiles(username, avatar_path, bio))')
      .order('last_message_at', { ascending: false })
    if (!this.alive) return
    if (error) { toast(friendlyError(error), 'error'); return }
    this.rooms = data
    for (const r of data) for (const p of r.participants) if (p.profiles) this.people.set(p.profile_id, { ...p.profiles, id: p.profile_id })
    this.renderRooms()
    if (this.currentId) {
      const r = this.room()
      if (!r) { this.currentId = null; this.setPaneVisible(false); go('#/chat'); toast('That chat is no longer available.') }
      else this.renderHeader()
    }
    this.refreshStatuses()
  }

  room(id = this.currentId) { return this.rooms.find((r) => r.id === id) }
  peerOf(r) { return r.is_direct ? r.participants.find((p) => p.profile_id !== this.me.id)?.profile_id : null }
  title(r) {
    if (!r.is_direct) return r.name
    return this.people.get(this.peerOf(r))?.username || 'Direct chat'
  }
  myRole(r) { return r?.participants.find((p) => p.profile_id === this.me.id)?.role }

  roomAvatar(r, size = '') {
    const peer = this.peerOf(r)
    const el = peer ? this.avatar(peer, size) : h('span', { class: `avatar ${size}`, 'aria-hidden': 'true' }, (r.name || '?').slice(0, 1).toUpperCase())
    if (!peer) return el
    const wrap = h('span', { class: 'avatar-wrap' }, el, this.dot(peer))
    return wrap
  }

  renderRooms() {
    clear(this.roomList)
    if (!this.rooms.length) {
      this.roomList.append(h('li', { class: 'room-empty' }, 'No chats yet. Use ✎ to message someone or 👥 to create a group.'))
      return
    }
    for (const r of this.rooms) {
      const unread = this.unread.has(r.id)
      const peer = this.peerOf(r)
      const sub = r.is_direct ? (describeStatus(this.status.get(peer)) || 'Direct chat') : `${r.participants.length} members`
      this.roomList.append(h('li', {},
        h('a', { class: `room-item${r.id === this.currentId ? ' active' : ''}${unread ? ' unread' : ''}`, href: `#/chat/${r.id}`, 'aria-current': r.id === this.currentId ? 'true' : null },
          this.roomAvatar(r),
          h('span', { class: 'room-meta' },
            h('span', { class: 'room-name' }, this.title(r)),
            h('span', { class: 'room-sub' }, sub)),
          unread && h('span', { class: 'dot', 'aria-label': 'New messages' }))))
    }
    this.hydrateAvatars(this.roomList)
  }

  renderHeader() {
    const r = this.room()
    if (!r) return
    this.paneTitle.textContent = this.title(r)
    const peer = this.peerOf(r)
    this.paneSub.textContent = r.is_direct
      ? (describeStatus(this.status.get(peer)) || 'Direct chat')
      : r.participants.map((p) => this.nameOf(p.profile_id)).join(', ')
    const fresh = this.roomAvatar(r, 'sm')
    this.paneAvatar.replaceWith(fresh); this.paneAvatar = fresh
    if (peer) { fresh.classList.add('clickable'); fresh.onclick = () => this.showProfile(peer) }
    this.hydrateAvatars(fresh)
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
    this.refreshStatuses()
    await this.loadMessages(true)
    this.input.focus({ preventScroll: true })
  }

  async loadMessages(scrollDown) {
    const id = this.currentId, token = ++this.loadToken
    const { data, error } = await supabase.from('messages').select(MSG_COLS)
      .eq('room_id', id).order('created_at', { ascending: false }).limit(PAGE)
    if (token !== this.loadToken || !this.alive) return
    if (error) return toast(friendlyError(error), 'error')
    this.messages = data.reverse()
    this.hasMore = data.length === PAGE
    await this.ensurePeople(this.messages.map((m) => m.sender_id))
    if (token !== this.loadToken) return
    this.renderMessages(scrollDown)
  }

  async loadOlder() {
    const first = this.messages[0]; if (!first) return
    const id = this.currentId
    const { data, error } = await supabase.from('messages').select(MSG_COLS)
      .eq('room_id', id).lt('created_at', first.created_at).order('created_at', { ascending: false }).limit(PAGE)
    if (error) return toast(friendlyError(error), 'error')
    if (id !== this.currentId) return
    this.hasMore = data.length === PAGE
    this.messages = data.reverse().concat(this.messages)
    await this.ensurePeople(data.map((m) => m.sender_id))
    const el = this.messagesEl, prev = el.scrollHeight
    this.renderMessages(false)
    el.scrollTop = el.scrollHeight - prev
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
    this.stick = !!(scrollDown || nearBottom)
    if (this.stick) el.scrollTop = el.scrollHeight
    this.hydrateAttachments(el)
  }

  // Fill in photos / video / audio once their temporary links are ready.
  async hydrateAttachments(scope) {
    const els = [...scope.querySelectorAll('[data-attach]')]
    if (!els.length) return
    const room = this.currentId
    const urls = await signedUrls('media', els.map((e) => e.dataset.attach))
    if (!this.alive || room !== this.currentId) return
    for (const el of els) {
      const url = urls.get(el.dataset.attach)
      if (!url) { el.textContent = 'Could not load this file.'; continue }
      const type = el.dataset.type
      const k = kind(type)
      el.textContent = ''
      if (k === 'image') {
        const img = h('img', { src: url, alt: el.dataset.name, loading: 'lazy', referrerPolicy: 'no-referrer' })
        img.addEventListener('load', () => { if (this.stick) this.messagesEl.scrollTop = this.messagesEl.scrollHeight })
        el.append(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Open full size' }, img))
      } else if (k === 'video') {
        el.append(h('video', { src: url, controls: true, preload: 'metadata', playsInline: true }))
      } else if (k === 'audio') {
        el.append(h('audio', { src: url, controls: true, preload: 'none' }))
      }
    }
  }

  attachmentEl(m) {
    const k = kind(m.attachment_type)
    const label = `${m.attachment_name} · ${fmtSize(m.attachment_size)}`
    if (k === 'file') {
      return h('button', { class: 'file-chip', type: 'button', title: 'Download', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true
        const url = await signedUrl('media', m.attachment_path, m.attachment_name)
        b.disabled = false
        if (!url) return toast('Could not open this file.', 'error')
        const a = h('a', { href: url, rel: 'noopener noreferrer', download: m.attachment_name })
        document.body.append(a); a.click(); a.remove()
      } }, h('span', { 'aria-hidden': 'true' }, '📄'), h('span', { class: 'fname' }, label))
    }
    return h('div', { class: `attach ${k}`, dataset: { attach: m.attachment_path, type: m.attachment_type, name: m.attachment_name } },
      h('span', { class: 'small' }, `Loading ${label}…`))
  }

  messageEl(m, own, iAmAdmin, grouped) {
    const editing = this.editingId === m.id
    let body
    if (editing) {
      const ta = h('textarea', { class: 'edit-input', maxLength: MAX_LEN, rows: 2, 'aria-label': 'Edit message' }, '')
      ta.value = m.content
      const save = async () => {
        const v = ta.value.trim()
        if (!v && !m.attachment_path) return toast('Message cannot be empty.', 'error')
        if (v !== m.content) {
          const { data, error } = await supabase.from('messages').update({ content: v }).eq('id', m.id).select(MSG_COLS).maybeSingle()
          if (error || !data) return toast(error ? friendlyError(error) : 'Could not edit that message.', 'error')
          this.onUpdate(data)
        }
        this.editingId = null; this.renderMessages(false)
      }
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save() }
        if (e.key === 'Escape') { this.editingId = null; this.renderMessages(false) }
      })
      body = [m.attachment_path && this.attachmentEl(m), ta, h('div', { class: 'row tight' },
        h('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Save'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { this.editingId = null; this.renderMessages(false) } }, 'Cancel'))]
      setTimeout(() => ta.focus(), 0)
    } else {
      body = [m.attachment_path && this.attachmentEl(m), m.content && h('div', { class: 'text' }, m.content)]   // text only: safe against HTML injection
    }
    const actions = editing ? null : h('div', { class: 'msg-actions' },
      own && h('button', { class: 'linkish', type: 'button', onclick: () => { this.editingId = m.id; this.renderMessages(false) } }, m.attachment_path ? 'Edit caption' : 'Edit'),
      (own || iAmAdmin) && h('button', { class: 'linkish', type: 'button', onclick: () => this.deleteMessage(m) }, 'Delete'),
      !own && h('button', { class: 'linkish', type: 'button', onclick: () => this.reportMessage(m) }, 'Report'))
    return h('div', { class: `msg-row ${own ? 'own' : 'other'}${grouped ? ' grouped' : ''}`, dataset: { id: m.id } },
      h('div', { class: 'bubble' },
        !grouped && h('div', { class: 'meta' }, own ? 'You' : h('button', { class: 'linkish plain', type: 'button', onclick: () => this.showProfile(m.sender_id) }, this.nameOf(m.sender_id))),
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
      await this.ensurePeople([m.sender_id])
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
      .insert({ room_id: this.currentId, sender_id: this.me.id, content }).select(MSG_COLS).single()
    this.sending = false; this.sendBtn.disabled = false
    if (error) return toast(friendlyError(error), 'error')
    this.input.value = ''; this.input.style.height = 'auto'; this.counter.textContent = ''
    this.onInsert(data)
    this.input.focus()
  }

  // Step 1: show what is about to be sent (with an optional caption) so nothing goes out by accident.
  askSendFile(file) {
    if (!this.currentId) return toast('Open a chat first.', 'error')
    const type = resolveType(file)
    const roomId = this.currentId
    const caption = h('input', { type: 'text', maxLength: 300, placeholder: 'Add a caption (optional)', 'aria-label': 'Caption' })
    const err = h('div', { class: 'msg error', role: 'alert' })
    let preview = null
    if (type && type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      preview = h('img', { class: 'preview', src: url, alt: 'Preview' })
      preview.addEventListener('load', () => URL.revokeObjectURL(url), { once: true })
    }
    dialog({
      title: 'Send this file?',
      body: [preview, h('p', {}, h('strong', {}, file.name.slice(0, 120)), ` · ${fmtSize(file.size)}`),
        caption,
        h('p', { class: 'small' }, 'Everyone in this chat can see and download it. Photos are re-saved without location data; other files are sent as they are. Files are not scanned for viruses.'), err],
      actions: [{ label: 'Cancel' }, { label: 'Send', kind: 'primary', onClick: async () => {
        const ok = await this.sendFile(file, caption.value.trim(), roomId, err)
        return ok ? undefined : 'keep-open'
      } }],
    })
  }

  async sendFile(file, caption, roomId, errEl) {
    let up = null
    try {
      toast('Uploading…')
      up = await uploadAttachment(roomId, this.me.id, file)
      const { data, error } = await supabase.from('messages').insert({
        room_id: roomId, sender_id: this.me.id, content: caption.slice(0, MAX_LEN),
        attachment_path: up.path, attachment_name: up.name, attachment_type: up.type, attachment_size: up.size,
      }).select(MSG_COLS).single()
      if (error) throw error
      this.onInsert(data)
      return true
    } catch (e) {
      if (up) removeFiles('media', [up.path]).catch(() => {})     // do not leave an orphan upload behind
      const msg = /Payload too large|exceeded|413/i.test(e.message || '') ? 'That file is too large.' : friendlyError(e)
      if (errEl) errEl.textContent = msg; else toast(msg, 'error')
      return false
    }
  }

  async deleteMessage(m) {
    if (!(await confirmDialog('Delete message?', m.attachment_path ? 'This removes the message and its file for everyone in the room.' : 'This removes it for everyone in the room.', 'Delete', true))) return
    if (m.attachment_path) {
      try { await removeFiles('media', [m.attachment_path]) } catch (e) { return toast('Could not remove the file: ' + friendlyError(e), 'error') }
    }
    const { error } = await supabase.from('messages').delete().eq('id', m.id)
    if (error) return toast(friendlyError(error), 'error')
    this.onDelete(m.id)
  }

  reportMessage(m) {
    const reason = h('textarea', { rows: 3, maxLength: 500, 'aria-label': 'Reason', placeholder: 'What is wrong with this message?' })
    const err = h('div', { class: 'msg error', role: 'alert' })
    dialog({
      title: 'Report message',
      body: [h('p', { class: 'small' }, 'The operator will receive this message (and its file, if any) and your reason. The sender is not told who reported it.'),
        h('blockquote', {}, (m.content || `[file: ${m.attachment_name}]`).slice(0, 300)), reason, err],
      actions: [{ label: 'Cancel' }, { label: 'Send report', kind: 'primary', onClick: async () => {
        if (!reason.value.trim()) { err.textContent = 'Please describe the problem.'; return 'keep-open' }
        const { error } = await supabase.rpc('report_message', { p_message: m.id, p_reason: reason.value.trim() })
        if (error) { err.textContent = friendlyError(error); return 'keep-open' }
        toast('Report sent. Thank you.', 'success')
      } }],
    })
  }

  /* ---------- profile card ---------- */
  async showProfile(id) {
    await this.ensurePeople([id])
    const p = this.people.get(id)
    if (!p) return toast('Profile not found.', 'error')
    const st = describeStatus(this.status.get(id))
    const big = this.avatar(id, 'xl')
    const body = [
      h('div', { class: 'profile-card' }, big,
        h('h3', {}, p.username), st && h('p', { class: 'small' }, st),
        h('p', { class: 'bio' }, p.bio || 'No bio yet.')),
    ]
    const actions = [{ label: 'Close' }]
    let d
    if (id !== this.me.id) actions.unshift({ label: 'Message', kind: 'primary', close: false, onClick: async () => {
      const { data, error } = await supabase.rpc('create_direct_room', { other_user_id: id })
      if (error) return toast(friendlyError(error), 'error')
      d.close(); await this.loadRooms(); go(`#/chat/${data}`)
    } })
    d = dialog({ title: 'Profile', body, actions })
    this.hydrateAvatars(d.el)
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
      const { data, error } = await supabase.from('profiles').select('id, username, avatar_path, bio')
        .ilike('username', `%${escapeLike(q)}%`).neq('id', this.me.id).order('username').limit(20)
      if (my !== seq) return
      if (error) { hint.textContent = friendlyError(error); return }
      const rows = data.filter((u) => !exclude.includes(u.id))
      hint.textContent = rows.length ? '' : 'No users found.'
      for (const u of rows) {
        this.people.set(u.id, u)
        list.append(h('li', {}, h('button', { type: 'button', class: 'pick', onclick: () => onPick(u) }, this.avatar(u.id, 'xs'), ' ', u.username)))
      }
      this.hydrateAvatars(list)
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

  // When the LAST member leaves, the room and its messages are deleted, so delete its files too.
  async removeRoomFiles(rid) {
    const files = await listFiles('media', rid, 1)
    if (files.length) await removeFiles('media', files)
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
        const st = describeStatus(this.status.get(p.profile_id))
        ul.append(h('li', {},
          h('button', { class: 'member-main', type: 'button', onclick: () => this.showProfile(p.profile_id) },
            h('span', { class: 'avatar-wrap' }, this.avatar(p.profile_id, 'xs'), this.dot(p.profile_id)),
            h('span', {}, this.nameOf(p.profile_id), self ? ' (you)' : '', p.role === 'admin' && !r.is_direct ? h('em', { class: 'badge' }, 'admin') : '',
              st && h('small', { class: 'block' }, st))),
          admin && !self && h('span', { class: 'row tight' },
            h('button', { class: 'linkish', type: 'button', onclick: () => rpc('set_member_role', { p_room: rid, p_user: p.profile_id, new_role: p.role === 'admin' ? 'member' : 'admin' }) }, p.role === 'admin' ? 'Make member' : 'Make admin'),
            h('button', { class: 'linkish', type: 'button', onclick: async () => { if (await confirmDialog('Remove member?', `Remove ${this.nameOf(p.profile_id)} from this group?`, 'Remove', true)) rpc('remove_room_member', { p_room: rid, p_user: p.profile_id }) } }, 'Remove'))))
      }
      body.append(ul)
      this.hydrateAvatars(body)
      if (admin) {
        body.append(h('h3', {}, 'Add someone'), this.userPicker({ exclude: r.participants.map((p) => p.profile_id), onPick: (u) => rpc('add_room_member', { p_room: rid, p_user: u.id }, `${u.username} added`) }).el)
      }
      if (!r.is_direct) {
        body.append(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          const last = r.participants.length === 1
          if (!(await confirmDialog('Leave this group?', last ? 'You are the last member, so the group, its messages and its files will be deleted.' : 'You will stop receiving messages from it. Files you shared stay in the group.', 'Leave', true))) return
          if (last) { try { await this.removeRoomFiles(rid) } catch (e) { return toast('Could not delete the files: ' + friendlyError(e), 'error') } }
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
