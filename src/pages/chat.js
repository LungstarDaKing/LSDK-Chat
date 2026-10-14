import { supabase } from '../lib/supabase.js'
import { h, clear, toast, dialog, confirmDialog, debounce, friendlyError } from '../lib/dom.js'
import { CONFIG } from '../config.js'
import { state, go } from '../lib/state.js'
import { ACCEPT, kind, fmtSize, uploadAttachment, removeFiles, signedUrls, signedUrl, listFiles, resolveType } from '../lib/media.js'
import { fetchStatuses, describeStatus } from '../lib/status.js'
import { notifyIncoming } from '../lib/sound.js'
import { RoomEvents, typingEnabled } from '../lib/room-events.js'
import { startRecording, voiceSupported, fmtDuration } from '../lib/voice.js'
import { CallManager, supabaseCallApi, callsSupported } from '../lib/calls.js'
import { CallOverlay, renderCalls } from '../ui/calls-ui.js'
import { renderUpdates } from '../ui/stories-ui.js'
import { sweepMyStories, markStatusSeen, newActivityCount } from '../lib/stories.js'
import { likeChime, likeSoundEnabled } from '../lib/sound.js'
import { reactToMessage, loadReactions, setReaction, summarize } from '../lib/reactions.js'
import { attachHold, openReactSheet } from '../ui/react-sheet.js'
import { personalSection } from '../ui/person-prefs.js'
import { setChatPeer } from '../lib/theme.js'
import { getNotesRoom, setMarkedUnread, loadMarkedUnread, saveMessage, listSaved, setReminder, scheduleMessage } from '../lib/tools.js'
import { whenDialog, saveDialog } from '../ui/when-dialog.js'
import { dictationSupported, startDictation, commandOf } from '../lib/dictation.js'
import { getA11y } from '../lib/a11y.js'
import { icon } from '../ui/icons.js'
import { GroupCallManager, supabaseGroupApi } from '../lib/group-calls.js'
import { GroupCallOverlay } from '../ui/group-call-ui.js'
import { GamesController } from '../ui/games-ui.js'
import { WatchController } from '../ui/watch-ui.js'
import { loadNicknames, watchNicknames, onNicknames, nickOf, nickFor } from '../lib/nicknames.js'
import logoUrl from '../assets/logo.svg'

const PAGE = 50
const MAX_LEN = 1000
const MSG_COLS = '*'          // all columns, so newer columns (status_label, v0.9) never break an older database

let chat = null
// Leaving the chat screen (Tools, Settings, Profile) must not end a call or a watch-together session.
// While one is running the chat is only set aside (hidden) and picked up again when you come back.
export function teardownChat(force = false) {
  if (chat && !force && chat.isLive()) { chat.detached = true; return }
  if (chat) chat.destroy()
  chat = null
}
export function renderChat(root, roomId, msgId = null) {
  if (chat?.detached) { chat.detached = false; clear(root).append(chat.el) }
  else if (!chat || !root.contains(chat.el)) {
    teardownChat(true)
    chat = new Chat(root)
  }
  chat.open(roomId, msgId)
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c)
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
const fmtDay = (iso) => {
  const d = new Date(iso), now = new Date()
  if (sameDay(d, now)) return 'Today'
  if (sameDay(d, new Date(now.getTime() - 864e5))) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}
// Chat-list time: today = clock, yesterday, this week = weekday, otherwise short date.
const listTime = (iso) => {
  const d = new Date(iso), now = new Date()
  if (sameDay(d, now)) return fmtTime(iso)
  if (sameDay(d, new Date(now.getTime() - 864e5))) return 'Yesterday'
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : {}) })
}
// Each person gets one of six colours (from the Ndebele palette), stable across devices.
const colourOf = (id = '') => { let n = 0; for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0; return n % 6 }
const draftKey = (id) => `lsdkchat.draft.${id}`
const getDraft = (id) => { try { return localStorage.getItem(draftKey(id)) || '' } catch { return '' } }
const putDraft = (id, v) => { try { v ? localStorage.setItem(draftKey(id), v) : localStorage.removeItem(draftKey(id)) } catch { /* ignore */ } }
const attachIcon = (m) => (m.attachment_duration != null ? 'mic' : { image: 'image', video: 'video', audio: 'music' }[kind(m.attachment_type)] || 'file')
const attachWord = (m) => (m.attachment_duration != null ? 'Voice note' : { image: 'Photo', video: 'Video', audio: 'Audio' }[kind(m.attachment_type)] || m.attachment_name || 'File')

class Chat {
  constructor(root) {
    this.me = state.profile
    this.rooms = []
    this.people = new Map([[this.me.id, { username: this.me.username, avatar_path: this.me.avatar_path, bio: this.me.bio }]])
    this.status = new Map()
    this.unread = new Map()
    this.flags = new Set()
    this.dictStop = null
    this.reads = new Map()
    this.typers = new Map()
    this.players = new Map()
    this.reactions = new Map()
    this.replyTo = null
    this.replyCache = new Map()
    this.tab = 'chats'
    this.receipts = true
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
    this.previews = new Map()
    this.filter = 'all'
    this.roomsLoaded = false
    this.loadingMsgs = false
    this.newBelow = 0
    this.build(root)
    this.init()
  }

  /* ---------- DOM skeleton ---------- */
  build(root) {
    this.roomList = h('ul', { class: 'room-list', 'aria-label': 'Your chats' })
    this.chatsView = h('div', { class: 'tab-view', role: 'tabpanel' }, this.roomList)
    this.updatesView = h('div', { class: 'tab-view', role: 'tabpanel', hidden: true })
    this.callsView = h('div', { class: 'tab-view', role: 'tabpanel', hidden: true })
    this.banner = h('div', { class: 'banner', role: 'status', hidden: true }, 'Connection lost - reconnecting…')
    this.badges = { chats: h('span', { class: 'tab-badge', hidden: true }), updates: h('span', { class: 'tab-badge', hidden: true }), calls: h('span', { class: 'tab-badge', hidden: true }) }
    this.tabBtns = {}
    const tab = (id, ico, label) => {
      this.tabBtns[id] = h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'false', title: label, onclick: () => this.setTab(id) },
        h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, icon(ico, 22), this.badges[id]), h('span', { class: 'tab-label' }, label))
      return this.tabBtns[id]
    }
    const navLink = (href, ico, label) => h('a', { class: 'tab', href, title: label },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, typeof ico === 'string' ? icon(ico, 22) : ico), h('span', { class: 'tab-label' }, label))
    this.tabs = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' },
      tab('chats', 'chat', 'Chats'), tab('updates', 'status', 'Status'), tab('calls', 'phone', 'Calls'),
      navLink('#/tools', 'grid', 'Tools'), navLink('#/settings', this.avatar(this.me.id, 'xs'), 'You'))
    this.colTitle = h('h1', { class: 'col-title' }, 'Chats')
    this.headActions = h('div', { class: 'row tight' },
      h('button', { class: 'btn icon ghost', type: 'button', title: 'Notes to myself', 'aria-label': 'Notes to myself', onclick: () => this.openNotes() }, icon('note')),
      h('button', { class: 'btn icon ghost', type: 'button', title: 'New group', 'aria-label': 'New group', onclick: () => this.newGroup() }, icon('users')),
      h('button', { class: 'btn icon soft', type: 'button', title: 'New chat', 'aria-label': 'New direct chat', onclick: () => this.newDirect() }, icon('compose')))
    this.searchPill = h('a', { class: 'search-pill', href: '#/tools/search', 'aria-label': 'Search messages (Ctrl+K)' }, icon('search', 18), h('span', {}, 'Search messages'), h('kbd', {}, navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K'))
    this.filterBtns = {}
    this.filterBar = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter chats' },
      [['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups']].map(([id, label]) => (this.filterBtns[id] = h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(id === 'all'), onclick: () => this.setFilter(id) }, label))))

    this.paneTitle = h('h2', { class: 'pane-title' })
    this.paneSub = h('div', { class: 'pane-sub' })
    this.paneAvatar = h('span', { class: 'avatar sm' })
    this.games = new GamesController(this)
    this.watch = new WatchController(this)
    this.voiceCallBtn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Voice call', title: 'Voice call', onclick: () => this.callRoom('voice') }, icon('phone'))
    this.videoCallBtn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Video call', title: 'Video call', onclick: () => this.callRoom('video') }, icon('video'))
    this.infoBtn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Chat info', title: 'Chat info', onclick: () => this.openInfo() }, icon('info'))
    this.messagesEl = h('div', { class: 'messages', role: 'log', 'aria-live': getA11y().announce ? 'polite' : 'off', 'aria-label': 'Messages' })
    this.jumpCount = h('span', { class: 'jump-count', hidden: true })
    this.jumpBtn = h('button', { class: 'jump', type: 'button', hidden: true, 'aria-label': 'Jump to the latest message', title: 'Latest messages', onclick: () => { this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior: 'smooth' }) } }, this.jumpCount, icon('down', 20))
    this.callBanner = h('div', { class: 'call-banner', hidden: true })
    this.thread = h('div', { class: 'thread' }, this.messagesEl, this.jumpBtn)
    this.messagesEl.addEventListener('scroll', () => {
      const near = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 80
      this.stick = near
      if (near) this.newBelow = 0
      this.syncJump()
    }, { passive: true })
    this.typingRow = h('div', { class: 'msg-row other typing-row', 'aria-hidden': 'true' }, h('div', { class: 'bubble typing-bubble' }, h('i'), h('i'), h('i')))
    this.fileInput = h('input', { type: 'file', accept: ACCEPT, hidden: true, 'aria-label': 'Choose a file to send',
      onchange: () => { const f = this.fileInput.files[0]; this.fileInput.value = ''; if (f) this.askSendFile(f) } })
    this.attachBtn = h('button', { class: 'btn icon ghost', type: 'button', title: 'Send a photo, video, audio or PDF', 'aria-label': 'Attach a file', onclick: () => this.fileInput.click() }, icon('paperclip'))
    this.input = h('textarea', {
      class: 'composer-input', rows: 1, maxLength: MAX_LEN, placeholder: 'Write a message…', 'aria-label': 'Message',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send() } else if (e.key === 'Escape' && this.replyTo) this.setReply(null) },
      oninput: () => {
        this.autosize()
        if (this.currentId) this.saveDraft()
        this.counter.textContent = this.input.value.length > 800 ? `${this.input.value.length}/${MAX_LEN}` : ''
        this.syncSendMic()
        if (this.input.value) this.events.typing()
      },
      onpaste: (e) => {
        const f = [...(e.clipboardData?.files || [])][0]
        if (f) { e.preventDefault(); this.askSendFile(f) }
      },
    })
    this.counter = h('span', { class: 'counter' })
    this.sendBtn = h('button', { class: 'btn primary round send', type: 'button', 'aria-label': 'Send', title: 'Send', onclick: () => this.send() }, icon('send', 20))
    this.schedBtn = h('button', { class: 'btn icon ghost', type: 'button', title: 'Send later', 'aria-label': 'Send this message later', onclick: () => this.scheduleDialog() }, icon('clock'))
    this.dictBtn = h('button', { class: 'btn icon ghost', type: 'button', title: 'Dictate (speak to type)', 'aria-label': 'Dictate: speak to type', 'aria-pressed': 'false', onclick: () => this.toggleDictation() }, icon('waveform'))
    this.micBtn = h('button', { class: 'btn primary round send', type: 'button', 'aria-label': 'Record a voice note', title: 'Record a voice note', onclick: () => this.startVoice() }, icon('mic', 20))
    this.recTime = h('span', { class: 'rec-time' }, '0:00')
    this.recBar = h('div', { class: 'rec-bar', hidden: true },
      h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Discard recording', title: 'Discard', onclick: () => this.cancelVoice() }, icon('trash')),
      h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), this.recTime, h('span', { class: 'small grow' }, 'Recording…'),
      h('button', { class: 'btn primary round send', type: 'button', 'aria-label': 'Send voice note', title: 'Send voice note', onclick: () => this.finishVoice() }, icon('send', 20)))
    this.composerMain = h('div', { class: 'composer-main' }, this.attachBtn, this.fileInput, this.input, this.counter, this.dictBtn, this.schedBtn, this.sendBtn, this.micBtn)
    this.replyBar = h('div', { class: 'reply-bar', hidden: true })
    this.composer = h('div', { class: 'composer' }, this.replyBar, this.composerMain, this.recBar)
    this.syncSendMic()
    this.empty = h('div', { class: 'empty' }, h('img', { class: 'empty-logo', src: logoUrl, alt: '', width: 96, height: 96 }), h('h2', {}, CONFIG.appName),
      h('p', {}, 'Pick a chat on the left, or start a new one.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => this.newDirect() }, icon('compose', 18), 'New chat'))
    this.pane = h('section', { class: 'pane' },
      h('header', { class: 'pane-head' },
        h('button', { class: 'btn icon ghost back', type: 'button', 'aria-label': 'Back to chats', onclick: () => go('#/chat') }, icon('back')),
        this.paneAvatar,
        h('div', { class: 'pane-titles' }, this.paneTitle, this.paneSub), this.voiceCallBtn, this.videoCallBtn, this.watch.btn, this.games.btn, this.infoBtn),
      this.callBanner, this.games.banner, this.watch.banner, this.thread, this.composer)
    // drag & drop a file onto the conversation
    this.pane.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() })
    this.pane.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0]
      if (f) { e.preventDefault(); this.askSendFile(f) }
    })

    this.el = h('div', { class: 'chat' },
      h('a', { class: 'skip-link', href: '#/chat', onclick: (e) => { e.preventDefault(); (this.currentId ? this.input : this.roomList.querySelector('a'))?.focus() } }, 'Skip to conversation'),
      h('aside', { class: 'rail' }, h('a', { class: 'rail-logo', href: '#/chat', 'aria-label': `${CONFIG.appName} home` }, h('img', { src: logoUrl, alt: '', width: 40, height: 40 })), this.tabs),
      h('section', { class: 'list-col', 'aria-label': 'Conversations' },
        h('header', { class: 'side-head' }, this.colTitle, this.headActions),
        this.banner, this.searchPill, this.filterBar,
        this.chatsView, this.updatesView, this.callsView,
        h('footer', { class: 'side-foot' }, h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms'), ' · ',
          h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy'), ' · ',
          h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'Disclosures'))),
      this.empty, this.pane)
    clear(root).append(this.el)
    this.setPaneVisible(false)
    this.setTab('chats')
    this.hydrateAvatars(this.el)
  }

  setPaneVisible(on) {
    this.pane.hidden = !on
    this.empty.hidden = on
    this.el.classList.toggle('show-pane', on)
  }

  setTab(id) {
    this.tab = id
    const views = { chats: this.chatsView, updates: this.updatesView, calls: this.callsView }
    for (const [k, v] of Object.entries(views)) { v.hidden = k !== id; this.tabBtns[k]?.setAttribute('aria-selected', String(k === id)); this.tabBtns[k]?.classList.toggle('active', k === id) }
    this.colTitle.textContent = { chats: 'Chats', updates: 'Status', calls: 'Calls' }[id]
    this.headActions.hidden = this.searchPill.hidden = this.filterBar.hidden = id !== 'chats'
    if (id === 'updates') { markStatusSeen(); this.badges.updates.hidden = true; this.statusNew = 0; renderUpdates(this.updatesView, this) }
    if (id === 'calls') { try { localStorage.setItem('lsdkchat.callsSeen', new Date().toISOString()) } catch { /* ignore */ } this.badges.calls.hidden = true; renderCalls(this.callsView, this) }
  }

  setFilter(id) {
    this.filter = id
    for (const [k, b] of Object.entries(this.filterBtns)) b.setAttribute('aria-pressed', String(k === id))
    this.renderRooms()
  }
  autosize() { this.input.style.height = 'auto'; const sh = this.input.scrollHeight; if (sh > 0) this.input.style.height = Math.min(sh, 140) + 'px' }
  saveDraft() { putDraft(this.currentId, this.input.value) }
  syncJump() {
    const show = !this.stick && !!this.messages.length
    this.jumpBtn.hidden = !show
    this.jumpCount.hidden = !this.newBelow
    this.jumpCount.textContent = this.newBelow > 99 ? '99+' : String(this.newBelow || '')
  }

  syncSendMic() {
    const has = !!this.input.value.trim()
    this.sendBtn.hidden = !has
    this.schedBtn.hidden = !has
    this.dictBtn.hidden = !dictationSupported()
    this.micBtn.hidden = has || !voiceSupported()
  }

  /* ---------- lifecycle ---------- */
  async init() {
    sweepMyStories(this.me.id)
    this.events = new RoomEvents({ myId: this.me.id, onTyping: (r, u) => this.onTyping(r, u), onRead: (r) => this.onReadPing(r) })
    supabase.from('user_private').select('read_receipts').eq('id', this.me.id).maybeSingle().then(({ data }) => { if (data) this.receipts = data.read_receipts })
    if (callsSupported()) {
      this.calls = new CallManager({ api: supabaseCallApi(this.me.id), meId: this.me.id,
        onChange: (s) => this.overlay?.update(s), onEnded: (e) => this.onCallEnded(e), onNotice: (m) => toast(m) })
      this.overlay = new CallOverlay(this, this.calls)
      this.gcalls = new GroupCallManager({ api: supabaseGroupApi(this.me.id), meId: this.me.id,
        isBusy: () => this.calls.s.phase !== 'idle',
        onChange: (s) => this.goverlay?.update(s), onEnded: (e) => this.onGroupCallEnded(e), onFeed: () => this.refreshCallBannerSoon(), onNotice: (m) => toast(m) })
      this.goverlay = new GroupCallOverlay(this, this.gcalls)
      // someone phones me one-to-one while I am in a group call: tell them I cannot answer
      const ringRow = this.calls.onCallRow.bind(this.calls)
      this.calls.onCallRow = (c) => {
        if (this.gcalls.busy() && c.status === 'ringing' && c.callee_id === this.me.id) { this.calls.api.decline(c.id).catch(() => {}); return }
        ringRow(c)
      }
    }
    newActivityCount(this.me.id).then((n) => { if (this.alive && n && this.tab !== 'updates') this.setStatusBadge(n) }, () => {})
    await this.loadRooms()
    this.subscribe()
    loadNicknames(this.me.id); watchNicknames(this.me.id)
    this.unNick = onNicknames(() => { if (!this.alive) return; this.renderRooms(); if (this.currentId) { this.renderHeader(); this.renderMessages(false) } })
    this.poll = setInterval(() => { if (document.visibilityState === 'visible') this.loadRooms() }, 30000)
    this.onVis = () => { if (document.visibilityState === 'visible') { this.loadRooms(); this.markRead() } }
    document.addEventListener('visibilitychange', this.onVis)
    this.onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); go('#/tools/search') } }
    document.addEventListener('keydown', this.onKey)
  }

  // "Watch together" from the call screen: open the player in the chat you have with the person you are talking to
  watchWith(peerId) {
    const r = this.rooms.find((x) => x.is_direct && !x.notes_owner && x.participants.some((p) => p.profile_id === peerId))
    if (!r) return toast('Open a chat with them first.')
    this.watch.setRoom(r); this.watch.btn.hidden = false
    this.watch.open()
  }
  // a call or a shared player is running
  isLive() { return !!this.alive && ((this.calls && this.calls.s.phase !== 'idle') || (this.gcalls && this.gcalls.s.phase !== 'idle') || !!this.watch?.active) }
  // once whatever kept a set-aside chat alive has ended, let it go
  releaseIfDone() { if (this.detached && !this.isLive()) teardownChat(true) }

  destroy() {
    this.stopDictation()
    this.alive = false
    this.unNick?.()
    this.games?.destroy()
    this.watch?.destroy()
    clearInterval(this.poll)
    document.removeEventListener('visibilitychange', this.onVis)
    document.removeEventListener('keydown', this.onKey)
    if (this.channel) supabase.removeChannel(this.channel)
    this.events?.leave()
    this.rec?.cancel()
    this.calls?.hangup?.()
    this.calls?.destroy()
    clearTimeout(this.bannerT)
    this.gcalls?.hangup?.()
    this.gcalls?.destroy()
    this.goverlay?.hide()
    this.overlay?.hide()
  }

  subscribe() {
    this.channel = supabase.channel('messages-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => this.onInsert(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => this.onUpdate(p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => this.onDelete(p.old?.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (p) => this.onReaction(p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'story_likes' }, (p) => this.onStoryActivity('like', p.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'story_comments' }, (p) => this.onStoryActivity('comment', p.new))
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

  /* ---------- calls ---------- */
  async callPeer(peerId, kind) {
    if (!peerId) return
    if (!this.calls) return toast('Calls are not supported in this browser.', 'error')
    try { await this.calls.start(peerId, kind) } catch (e) { toast(friendlyError(e), 'error') }
  }
  // one tap in a direct chat calls the person, in a group chat it starts (or joins) a group call
  async callRoom(kind) {
    const r = this.room()
    if (!r || r.notes_owner) return
    if (r.is_direct) return this.callPeer(this.peerOf(r), kind)
    if (!this.gcalls) return toast('Calls are not supported in this browser.', 'error')
    try { await this.gcalls.start(r.id, kind) } catch (e) { toast(friendlyError(e), 'error') }
  }
  async startGroupCall(roomId, kind) {
    if (!this.gcalls) return toast('Calls are not supported in this browser.', 'error')
    try { await this.gcalls.start(roomId, kind) } catch (e) { toast(friendlyError(e), 'error') }
  }
  async joinGroupCall(callId) {
    if (!this.gcalls) return
    try { await this.gcalls.join(callId) } catch (e) { toast(friendlyError(e), 'error') }
  }
  onGroupCallEnded({ reason, message }) {
    setTimeout(() => this.releaseIfDone(), 0)
    if (message) toast(message, reason === 'error' ? 'error' : 'info')
    else if (reason === 'ended') toast('Call ended')
    if (this.tab === 'calls' && this.alive) renderCalls(this.callsView, this)
    this.refreshCallBannerSoon()
  }
  refreshCallBannerSoon() { clearTimeout(this.bannerT); this.bannerT = setTimeout(() => this.refreshCallBanner(), 400) }
  // "Group call in progress - Join" strip, so people who missed the ring can still jump in
  async refreshCallBanner() {
    const r = this.room()
    if (!this.alive || !this.gcalls || !r || r.is_direct || r.notes_owner) { if (this.callBanner) this.callBanner.hidden = true; return }
    let call = null
    try { call = await this.gcalls.api.activeForRoom(r.id) } catch { /* ignore */ }
    if (!this.alive || this.currentId !== r.id) return
    if (!call || this.gcalls.s.call?.id === call.id) { this.callBanner.hidden = true; return }
    clear(this.callBanner).append(h('span', { class: 'cb-text' }, icon(call.kind === 'video' ? 'video' : 'phone', 16), ` Group ${call.kind} call in progress`),
      h('button', { class: 'btn primary small', type: 'button', onclick: () => this.joinGroupCall(call.id) }, 'Join'))
    this.callBanner.hidden = false
  }
  onCallEnded({ reason, message }) {
    setTimeout(() => this.releaseIfDone(), 0)
    if (message && reason !== 'ended') toast(message, reason === 'error' ? 'error' : 'info')
    else if (reason === 'ended') toast('Call ended')
    if (this.tab === 'calls' && this.alive) renderCalls(this.callsView, this)
    else this.loadMissedBadge()
  }
  async loadMissedBadge() {
    let since = '1970-01-01'
    try { since = localStorage.getItem('lsdkchat.callsSeen') || since } catch { /* ignore */ }
    const { count } = await supabase.from('calls').select('id', { count: 'exact', head: true })
      .eq('callee_id', this.me.id).in('status', ['missed']).gt('created_at', since)
    if (!this.alive) return
    this.badges.calls.textContent = count > 9 ? '9+' : String(count || '')
    this.badges.calls.hidden = !count || this.tab === 'calls'
  }

  /* ---------- typing + seen ---------- */
  onTyping(roomId, uid) {
    if (roomId !== this.currentId || !typingEnabled()) return
    clearTimeout(this.typers.get(uid))
    this.typers.set(uid, setTimeout(() => { this.typers.delete(uid); this.drawTyping() }, 4000))
    this.drawTyping()
  }
  drawTyping() {
    const names = [...this.typers.keys()].map((u) => this.nameOf(u))
    const r = this.room()
    if (names.length) {
      this.paneSub.textContent = r?.is_direct ? 'typing…' : `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…`
      this.paneSub.classList.add('typing')
      if (!this.typingRow.isConnected) { this.messagesEl.append(this.typingRow); if (this.stick) this.messagesEl.scrollTop = this.messagesEl.scrollHeight }
    } else {
      this.paneSub.classList.remove('typing')
      this.typingRow.remove()
      if (r) this.renderHeader()
    }
  }
  clearTypers() { for (const t of this.typers.values()) clearTimeout(t); this.typers.clear(); this.typingRow.remove(); this.paneSub.classList.remove('typing') }

  onReadPing(roomId) { if (roomId === this.currentId) { clearTimeout(this.readT); this.readT = setTimeout(() => this.loadReads(), 400) } }
  async loadReads() {
    const id = this.currentId; if (!id) return
    const { data, error } = await supabase.rpc('get_room_reads', { p_room: id })
    if (!this.alive || id !== this.currentId || error) return
    this.reads = new Map((data || []).map((r) => [r.profile_id, new Date(r.last_read_at)]))
    this.renderMessages(false)
  }
  async markRead() {
    const id = this.currentId
    if (!id || document.visibilityState !== 'visible') return
    if (this.unread.has(id)) { this.unread.delete(id); this.renderRooms() }
    const { error } = await supabase.rpc('mark_room_read', { p_room: id })
    if (!error && this.receipts !== false) this.events.read()
  }

  /* ---------- people, avatars, status ---------- */
  usernameOf(id) { return this.people.get(id)?.username || 'Former member' }
  // What I see for this person: my nickname for them if I set one, otherwise their username.
  nameOf(id) { return (id !== this.me.id && nickOf(id)) || this.usernameOf(id) }

  // A round avatar: the first letter now, the picture as soon as its temporary link is ready.
  avatar(id, size = '') {
    const p = this.people.get(id)
    const el = h('span', { class: `avatar ${size} nc-${colourOf(id)}`, 'aria-hidden': 'true', dataset: p?.avatar_path ? { avatar: p.avatar_path } : {} }, (p?.username || '?').slice(0, 1).toUpperCase())
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
      .select('id, name, is_direct, notes_owner, last_message_at, participants(profile_id, role, joined_at, profiles(username, avatar_path, bio))')
      .order('last_message_at', { ascending: false })
    if (!this.alive) return
    if (error) { toast(friendlyError(error), 'error'); return }
    this.rooms = data
    await Promise.all([this.loadUnread(), this.loadPreviews()])
    this.roomsLoaded = true
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
    if (r.notes_owner) return 'Notes to myself'
    if (!r.is_direct) return r.name
    return this.nameOf(this.peerOf(r)) === 'Former member' ? 'Direct chat' : this.nameOf(this.peerOf(r))
  }
  myRole(r) { return r?.participants.find((p) => p.profile_id === this.me.id)?.role }

  roomAvatar(r, size = '') {
    const peer = this.peerOf(r)
    if (r.notes_owner) return h('span', { class: `avatar ${size} nc-note`, 'aria-hidden': 'true' }, icon('note', 22))
    const el = peer ? this.avatar(peer, size) : h('span', { class: `avatar ${size} nc-${colourOf(r.id)}`, 'aria-hidden': 'true' }, (r.name || '?').slice(0, 1).toUpperCase())
    if (!peer) return el
    const wrap = h('span', { class: 'avatar-wrap' }, el, this.dot(peer))
    return wrap
  }

  roomPreview(r) {
    const draft = r.id !== this.currentId ? getDraft(r.id) : ''
    if (draft) return [h('span', { class: 'draft' }, 'Draft: '), draft.slice(0, 80)]
    const p = this.previews.get(r.id)
    if (!p) return r.notes_owner ? 'Only you can see this chat' : r.is_direct ? (describeStatus(this.status.get(this.peerOf(r))) || 'Say hello') : `${r.participants.length} members`
    const who = p.sender_id === this.me.id ? 'You: ' : !r.is_direct ? `${this.nameOf(p.sender_id)}: ` : ''
    const media = p.attachment_name != null || p.attachment_type
    return [who, media && h('span', { class: 'pv-ico' }, icon(attachIcon(p), 14)), media ? (p.content || attachWord(p)) : p.content]
  }

  renderRooms() {
    clear(this.roomList)
    let total = 0
    for (const n of this.unread.values()) total += n
    for (const id of this.flags) if (!this.unread.has(id) && id !== this.currentId) total += 1
    this.badges.chats.textContent = total > 99 ? '99+' : String(total || '')
    this.badges.chats.hidden = !total
    if (!this.roomsLoaded) {
      for (let i = 0; i < 7; i++) this.roomList.append(h('li', { class: 'sk-row', 'aria-hidden': 'true' }, h('i', { class: 'sk sk-av' }), h('span', { class: 'sk-lines' }, h('i', { class: 'sk' }), h('i', { class: 'sk short' }))))
      return
    }
    if (!this.rooms.length) {
      this.roomList.append(h('li', { class: 'room-empty' }, h('img', { class: 'empty-logo sm', src: logoUrl, alt: '', width: 72, height: 72 }), h('h2', {}, 'No chats yet'),
        h('p', { class: 'small' }, 'Start a conversation with a friend, or make a group.'),
        h('div', { class: 'row center-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this.newDirect() }, icon('compose', 18), 'New chat'), h('button', { class: 'btn', type: 'button', onclick: () => this.newGroup() }, icon('users', 18), 'New group'))))
      return
    }
    const shown = this.rooms.filter((r) => this.filter === 'unread' ? (this.unread.get(r.id) || this.flags.has(r.id)) : this.filter === 'groups' ? !r.is_direct : true)
    if (!shown.length) {
      this.roomList.append(h('li', { class: 'room-empty' }, h('p', {}, this.filter === 'unread' ? 'You are all caught up.' : 'No groups yet.'), h('button', { class: 'linkish', type: 'button', onclick: () => this.setFilter('all') }, 'Show all chats')))
      return
    }
    for (const r of shown) {
      const n = this.unread.get(r.id) || 0
      const flagged = this.flags.has(r.id) && r.id !== this.currentId
      const when = this.previews.get(r.id)?.created_at || r.last_message_at
      let held = false
      const link = h('a', { class: `room-item${r.id === this.currentId ? ' active' : ''}${n || flagged ? ' unread' : ''}${flagged ? ' flagged' : ''}`, href: `#/chat/${r.id}`, 'aria-current': r.id === this.currentId ? 'true' : null,
          onclick: (e) => { if (held) { e.preventDefault(); held = false } } },
        this.roomAvatar(r, 'md'),
        h('span', { class: 'room-meta' },
          h('span', { class: 'room-top' }, h('span', { class: 'room-name' }, this.title(r)), when && h('time', { class: 'room-time', datetime: when }, listTime(when))),
          h('span', { class: 'room-bottom' }, h('span', { class: 'room-sub' }, this.roomPreview(r)),
            n > 0 && h('span', { class: 'count', 'aria-label': `${n} unread` }, n > 99 ? '99+' : n),
            !n && flagged && h('span', { class: 'count dot', 'aria-label': 'Marked as unread' }, '•'))))
      attachHold(link, () => { held = true; setTimeout(() => { held = false }, 700); this.roomMenu(r) })
      this.roomList.append(h('li', { class: 'room-li' }, link,
        h('button', { class: 'room-more', type: 'button', 'aria-label': `Options for ${this.title(r)}`, onclick: () => this.roomMenu(r) }, icon('down', 16))))
    }
    this.hydrateAvatars(this.roomList)
  }

  renderHeader() {
    const r = this.room()
    if (!r) return
    this.paneTitle.textContent = this.title(r)
    const peer = this.peerOf(r)
    setChatPeer(peer)
    if (!this.typers.size) {
      this.paneSub.textContent = r.notes_owner ? 'Only you can see this chat'
        : r.is_direct
        ? [nickOf(peer) && `@${this.usernameOf(peer)}`, describeStatus(this.status.get(peer)) || (nickOf(peer) ? '' : 'Direct chat')].filter(Boolean).join(' · ')
        : r.participants.map((p) => this.nameOf(p.profile_id)).join(', ')
    }
    this.voiceCallBtn.hidden = this.videoCallBtn.hidden = !!r.notes_owner || !this.calls
    this.refreshCallBannerSoon()
    this.games.setRoom(r)
    this.watch.setRoom(r)
    const fresh = this.roomAvatar(r, 'sm')
    this.paneAvatar.replaceWith(fresh); this.paneAvatar = fresh
    if (peer) { fresh.classList.add('clickable'); fresh.onclick = () => this.showProfile(peer) }
    this.hydrateAvatars(fresh)
  }

  async loadPreviews() {
    const { data, error } = await supabase.rpc('get_room_previews')
    if (!this.alive || error || !data) return                  // v0.8 SQL not run yet: the list falls back to status lines
    this.previews = new Map(data.map((p) => [p.room_id, p]))
  }

  async loadUnread() {
    const { data } = await supabase.rpc('get_unread_counts')
    if (!this.alive || !data) return
    const m = new Map()
    for (const r of data) if (r.unread > 0 && r.room_id !== this.currentId) m.set(r.room_id, r.unread)
    this.unread = m
    try { const f = await loadMarkedUnread(); f.delete(this.currentId); if (this.alive) this.flags = f } catch { /* v0.7 SQL not run yet */ }
  }

  /* ---------- open a room ---------- */
  async open(roomId, msgId = null) {
    if (!roomId) {
      this.events.leave(); this.clearTypers()
      this.currentId = null; setChatPeer(null); this.messages = []; this.setPaneVisible(false); this.renderRooms(); return
    }
    if (this.tab !== 'chats') this.setTab('chats')
    if (roomId === this.currentId) { this.setPaneVisible(true); if (msgId) this.jumpTo(msgId); return }
    if (!this.room(roomId)) {
      await this.loadRooms()
      if (!this.room(roomId)) { toast('Chat not found.', 'error'); return go('#/chat') }
    }
    this.cancelVoice()
    this.clearTypers()
    this.setReply(null)
    this.currentId = roomId
    this.unread.delete(roomId)
    this.stopDictation()
    if (this.flags.has(roomId)) { this.flags.delete(roomId); setMarkedUnread(roomId, false).catch(() => {}) }
    this.editingId = null
    this.messages = []
    this.reads = new Map()
    this.players.clear()
    this.reactions = new Map()
    this.hasMore = false
    this.events.join(roomId)
    this.loadingMsgs = true; this.newBelow = 0; this.stick = true
    this.input.value = getDraft(roomId); this.syncSendMic()
    this.renderRooms(); this.renderHeader(); this.setPaneVisible(true); this.autosize()
    this.renderMessages(true)
    this.refreshStatuses()
    await this.loadMessages(true)
    this.markRead()
    this.loadReads()
    this.holdTip()
    if (msgId) this.jumpTo(msgId)
    else this.input.focus({ preventScroll: true })
  }

  async loadMessages(scrollDown) {
    const id = this.currentId, token = ++this.loadToken
    const { data, error } = await supabase.from('messages').select(MSG_COLS)
      .eq('room_id', id).order('created_at', { ascending: false }).limit(PAGE)
    if (token !== this.loadToken || !this.alive) return
    if (error) { this.loadingMsgs = false; this.renderMessages(false); return toast(friendlyError(error), 'error') }
    this.messages = data.reverse()
    this.hasMore = data.length === PAGE
    const rx = await loadReactions(id)
    await this.fetchReplyTargets(this.messages)
    await this.ensurePeople(this.messages.map((m) => m.sender_id))
    if (token !== this.loadToken) return
    this.reactions = rx
    this.loadingMsgs = false
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
    await this.fetchReplyTargets(data)
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
    if (this.loadingMsgs && !this.messages.length) {
      for (const [own, w] of [[0, 52], [0, 38], [1, 44], [0, 64], [1, 30]]) el.append(h('div', { class: `msg-row ${own ? 'own' : 'other'} sk-msg`, 'aria-hidden': 'true' }, h('i', { class: 'sk', dataset: { w } })))
      el.querySelectorAll('.sk-msg .sk').forEach((n) => { n.style.width = n.dataset.w + '%' })
    } else if (!this.messages.length && !this.hasMore) {
      el.append(h('div', { class: 'thread-empty' }, h('span', { class: 'te-ico' }, icon('chat', 30)), h('strong', {}, 'No messages yet'), h('span', { class: 'small' }, 'Say hello - it only takes one message to start.')))
    }
    const r = this.room(); const iAmAdmin = this.myRole(r) === 'admin'
    this.lastSeenId = null
    for (const m of this.messages) {
      if (m.sender_id !== this.me.id) continue
      if (r?.participants.some((p) => p.profile_id !== this.me.id && this.reads.get(p.profile_id) >= new Date(m.created_at))) this.lastSeenId = m.id
    }
    let prev = null
    for (const m of this.messages) {
      if (!prev || !sameDay(prev.created_at, m.created_at)) el.append(h('div', { class: 'day' }, fmtDay(m.created_at)))
      el.append(this.messageEl(m, m.sender_id === this.me.id, iAmAdmin, prev && prev.sender_id === m.sender_id && sameDay(prev.created_at, m.created_at)))
      prev = m
    }
    if (this.typers.size) el.append(this.typingRow)
    this.stick = !!(scrollDown || nearBottom)
    if (this.stick) { el.scrollTop = el.scrollHeight; this.newBelow = 0 }
    this.syncJump()
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
        el.append(h('button', { class: 'img-open', type: 'button', title: 'View photo', 'aria-label': `View photo ${el.dataset.name}`, onclick: () => this.lightbox(url, el.dataset.name) }, img))
      } else if (k === 'video') {
        el.append(h('video', { src: url, controls: true, preload: 'metadata', playsInline: true }))
      } else if (k === 'audio') {
        if (el.dataset.dur) el.append(this.players.get(el.dataset.attach) || this.voicePlayer(el.dataset.attach, url, Number(el.dataset.dur), el.dataset.name))
        else el.append(h('audio', { src: url, controls: true, preload: 'none' }))
      }
    }
  }

  // WhatsApp-style ticks: one tick = sent, two blue ticks = seen. The word "Seen" appears on the latest seen message.
  ticks(m) {
    const r = this.room()
    const readers = r ? r.participants.filter((p) => p.profile_id !== this.me.id && this.reads.get(p.profile_id) >= new Date(m.created_at)) : []
    const seen = readers.length > 0
    const word = seen && m.id === this.lastSeenId ? (r.is_direct ? ' Seen' : ` Seen by ${readers.length}`) : ''
    if (m._failed) return h('span', { class: 'ticks failed', 'aria-label': 'Not sent' }, icon('info', 14))
    if (m._pending) return h('span', { class: 'ticks pending', 'aria-label': 'Sending' }, icon('clock', 13))
    return h('span', { class: `ticks${seen ? ' seen' : ''}`, 'aria-label': seen ? 'Seen' : 'Sent' }, icon(seen ? 'checks' : 'check', 15), word && h('span', { class: 'seen-word' }, word))
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
      } }, h('span', { class: 'fc-ico', 'aria-hidden': 'true' }, icon('file', 22)), h('span', { class: 'fname' }, label), h('span', { class: 'fc-dl', 'aria-hidden': 'true' }, icon('download', 18)))
    }
    const voice = k === 'audio' && m.attachment_duration != null
    return h('div', { class: `attach ${k}${voice ? ' voice-wrap' : ''}`, dataset: { attach: m.attachment_path, type: m.attachment_type, name: m.attachment_name, ...(voice ? { dur: String(m.attachment_duration) } : {}) } },
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
    const live = !m._pending && !m._failed
    const tool = (ico, label, fn) => h('button', { class: 'ma-btn', type: 'button', title: label, 'aria-label': label, onclick: fn }, icon(ico, 16))
    const actions = editing || !live ? null : h('div', { class: 'msg-actions' },
      tool('reply', 'Reply', () => this.setReply(m)),
      tool('smile', 'React to this message', (e) => this.openMenu(m, e.currentTarget.closest('.bubble'), own, iAmAdmin)),
      tool('more', 'More actions', (e) => this.openMenu(m, e.currentTarget.closest('.bubble'), own, iAmAdmin)))
    const dm = this.room()?.is_direct
    const failBar = m._failed ? h('div', { class: 'failbar', role: 'alert' }, h('span', {}, 'Not sent'),
      h('button', { class: 'linkish', type: 'button', onclick: () => this.retrySend(m) }, 'Retry'),
      h('button', { class: 'linkish', type: 'button', onclick: () => this.dropPending(m) }, 'Delete')) : null
    const bubble = h('div', { class: `bubble${m._pending ? ' pending' : ''}${m._failed ? ' failed' : ''}` },
        m.status_label && h('div', { class: 'status-ref' }, icon('status', 14), h('span', {}, own ? `Your reply to a status · ${m.status_label.replace(/^Status:? ?/, '') || 'status'}` : `Replied to your status · ${m.status_label.replace(/^Status:? ?/, '') || ''}`)),
        this.quoteEl(m),
        !grouped && !own && !dm && h('div', { class: `meta nm-${colourOf(m.sender_id)}` }, h('button', { class: 'linkish plain', type: 'button', onclick: () => this.showProfile(m.sender_id) }, this.nameOf(m.sender_id))),
        body,
        this.reactionsEl(m),
        h('div', { class: 'foot' }, fmtTime(m.created_at), m.edited_at && ' · edited', own && this.ticks(m)),
        failBar,
        actions)
    if (!editing && live) {
      attachHold(bubble, (el) => this.openMenu(m, el, own, iAmAdmin))
      bubble.tabIndex = 0
      bubble.setAttribute('aria-label', `${own ? 'You' : this.nameOf(m.sender_id)}, ${fmtTime(m.created_at)}: ${m.content || (m.attachment_name ? 'attachment ' + m.attachment_name : '')}. Press Enter for actions.`)
      bubble.addEventListener('keydown', (e) => { if (e.target === bubble && (e.key === 'Enter' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); this.openMenu(m, bubble, own, iAmAdmin) } })
    }
    return h('div', { class: `msg-row ${own ? 'own' : 'other'}${grouped ? ' grouped' : ''}${m.id === this.flashId ? ' flash' : ''}`, dataset: { id: m.id } }, own && m._failed ? h('span', { class: 'fail-ico', 'aria-hidden': 'true' }, icon('info', 20)) : null, bubble)
  }

  /* ---------- replies ---------- */
  setReply(m) {
    this.replyTo = m
    clear(this.replyBar)
    this.replyBar.hidden = !m
    if (!m) return
    this.replyBar.append(h('div', { class: 'reply-quote' }, h('strong', {}, m.sender_id === this.me.id ? 'You' : this.nameOf(m.sender_id)), h('span', {}, this.previewOf(m))),
      h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Cancel reply', title: 'Cancel reply', onclick: () => this.setReply(null) }, icon('x', 18)))
    this.input.focus()
  }
  previewOf(m) {
    if (m.attachment_path) {
      const k = kind(m.attachment_type)
      const label = m.attachment_duration != null ? 'Voice note' : k === 'image' ? 'Photo' : k === 'video' ? 'Video' : k === 'audio' ? 'Audio' : (m.attachment_name || 'File')
      return m.content ? `${label} · ${m.content.slice(0, 60)}` : label
    }
    return (m.content || '').slice(0, 100)
  }
  async fetchReplyTargets(list) {
    const need = [...new Set(list.map((m) => m.reply_to).filter((id) => id && !this.replyCache.has(id) && !this.messages.some((x) => x.id === id) && !list.some((x) => x.id === id)))]
    for (const m of list) this.replyCache.set(m.id, m)
    if (!need.length) return
    const { data } = await supabase.from('messages').select('id, sender_id, content, attachment_path, attachment_name, attachment_type, attachment_duration').in('id', need)
    const got = new Set()
    for (const r of data || []) { this.replyCache.set(r.id, r); got.add(r.id) }
    for (const id of need) if (!got.has(id)) this.replyCache.set(id, null)      // deleted or not visible
    await this.ensurePeople((data || []).map((r) => r.sender_id))
  }
  quoteEl(m) {
    if (!m.reply_to) return null
    const t = this.replyCache.get(m.reply_to) ?? this.messages.find((x) => x.id === m.reply_to)
    if (!t) return h('div', { class: 'quote gone' }, 'Original message deleted')
    const who = t.sender_id === this.me.id ? 'You' : this.nameOf(t.sender_id)
    return h('button', { class: 'quote', type: 'button', 'aria-label': `In reply to ${who}: ${this.previewOf(t)}`, onclick: () => this.jumpTo(m.reply_to) },
      h('strong', {}, who), h('span', {}, this.previewOf(t)))
  }
  async jumpTo(id) {
    for (let i = 0; i < 6; i++) {
      const row = this.messagesEl.querySelector(`.msg-row[data-id="${id}"]`)
      if (row) {
        this.stick = false; this.flashId = id; clearTimeout(this.flashT)
        row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash')
        this.flashT = setTimeout(() => { this.flashId = null; this.messagesEl.querySelector('.msg-row.flash')?.classList.remove('flash') }, 2200); return
      }
      if (!this.hasMore) break
      await this.loadOlder()
    }
    toast('That message is too far back to show.', 'info')
  }

  /* ---------- reactions ---------- */
  holdTip() {
    try { if (localStorage.getItem('lsdkchat.tip') || !this.messages.length) return; localStorage.setItem('lsdkchat.tip', '1') } catch { return }
    toast('Tip: press and hold a message (or right-click it) to react with an emoji.')
  }

  reactionsEl(m) {
    const sum = summarize(this.reactions.get(m.id))
    if (!sum.length) return null
    return h('div', { class: 'reactions', role: 'group', 'aria-label': 'Reactions' }, sum.map((r) => {
      const mine = r.users.includes(this.me.id)
      return h('button', { type: 'button', class: `reaction${mine ? ' mine' : ''}`, title: r.users.map((u) => (u === this.me.id ? 'You' : this.nameOf(u))).join(', '),
        'aria-label': `${r.emoji} ${r.count}${mine ? ', including you' : ''}. Press to ${mine ? 'remove' : 'add'}`, 'aria-pressed': String(mine),
        onclick: () => this.react(m, r.emoji) }, r.emoji, r.count > 1 && h('span', { class: 'rc' }, r.count))
    }))
  }

  openMenu(m, bubble, own, iAmAdmin) {
    const mineNow = this.reactions.get(m.id)?.get(this.me.id)
    openReactSheet({
      anchor: bubble, current: mineNow, onPick: (e) => this.react(m, e),
      actions: [
        { icon: 'reply', label: 'Reply', onClick: () => this.setReply(m) },
        { icon: 'alarm', label: 'Remind me…', onClick: () => this.remindDialog(m) },
        { icon: 'bookmark', label: 'Save message…', onClick: () => this.saveMessageDialog(m) },
        m.content && { icon: 'copy', label: 'Copy text', onClick: () => navigator.clipboard?.writeText(m.content).then(() => toast('Copied', 'success'), () => toast('Could not copy.', 'error')) },
        m.attachment_path && { icon: 'download', label: 'Save file', onClick: () => this.saveAttachment(m) },
        own && { icon: 'compose', label: m.attachment_path ? 'Edit caption' : 'Edit', onClick: () => { this.editingId = m.id; this.renderMessages(false) } },
        !own && { icon: 'flag', label: 'Report', onClick: () => this.reportMessage(m) },
        (own || iAmAdmin) && { icon: 'trash', label: 'Delete', danger: true, onClick: () => this.deleteMessage(m) },
      ],
    })
  }

  async react(m, emoji) {
    const before = this.reactions.get(m.id)?.get(this.me.id)
    setReaction(this.reactions, m.id, this.me.id, before === emoji ? null : emoji)       // instant feedback
    this.renderMessages(false)
    try { await reactToMessage(m.id, emoji) } catch (e) {
      setReaction(this.reactions, m.id, this.me.id, before || null); this.renderMessages(false)
      toast(friendlyError(e), 'error')
    }
  }

  onReaction(p) {
    const row = p.eventType === 'DELETE' ? p.old : p.new
    if (!row?.message_id || !this.messages.some((x) => x.id === row.message_id)) return
    setReaction(this.reactions, row.message_id, row.user_id, p.eventType === 'DELETE' ? null : row.emoji)
    this.renderMessages(false)
  }

  async saveAttachment(m) {
    const url = await signedUrl('media', m.attachment_path, m.attachment_name)
    if (!url) return toast('Could not open this file.', 'error')
    const a = h('a', { href: url, rel: 'noopener noreferrer', download: m.attachment_name })
    document.body.append(a); a.click(); a.remove()
    toast('Saved to your downloads', 'success')
  }

  /* ---------- status likes / comments (notifications for the author) ---------- */
  setStatusBadge(n) { this.statusNew = n; this.badges.updates.textContent = n > 9 ? '9+' : String(n); this.badges.updates.hidden = !n }
  async onStoryActivity(kind, row) {
    if (!row || row.author_id !== this.me.id || row.user_id === this.me.id) return
    await this.ensurePeople([row.user_id])
    const who = this.nameOf(row.user_id)
    toast(kind === 'like' ? `❤️ ${who} liked your status` : `💬 ${who}: ${String(row.content).slice(0, 60)}`)
    if (likeSoundEnabled()) likeChime()
    if (this.tab === 'updates') renderUpdates(this.updatesView, this)
    else this.setStatusBadge((this.statusNew || 0) + 1)
  }

  /* ---------- realtime handlers ---------- */
  // Keep the chat list's order, preview line and time in step with a new message.
  touchRoom(m) {
    const r = this.room(m.room_id); if (!r) return
    const old = this.previews.get(m.room_id)
    if (!old || new Date(m.created_at) >= new Date(old.created_at) || String(old.id || '').startsWith('tmp-')) {
      this.previews.set(m.room_id, { room_id: m.room_id, sender_id: m.sender_id, content: (m.content || '').slice(0, 140), created_at: m.created_at, attachment_type: m.attachment_type || null, attachment_name: m.attachment_name || null })
    }
    r.last_message_at = m.created_at
    this.rooms.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
    this.renderRooms()
  }

  async onInsert(m) {
    if (!m) return
    const mine = m.sender_id === this.me.id
    const r = this.room(m.room_id)
    if (!r) { this.loadRooms(); if (!mine) { this.unread.set(m.room_id, (this.unread.get(m.room_id) || 0) + 1); notifyIncoming({ inCurrentRoom: false }) } return }
    if (m.room_id === this.currentId) {
      if (this.messages.some((x) => x.id === m.id)) { this.touchRoom(m); return }
      if (mine) {                                                   // the real copy of a message we are still sending
        const t = this.messages.findIndex((x) => x._pending && x.content === (m.content || '') && (x.reply_to || null) === (m.reply_to || null))
        if (t >= 0) { this.messages[t] = m; this.touchRoom(m); this.renderMessages(false); return }
      }
      await this.ensurePeople([m.sender_id])
      await this.fetchReplyTargets([m])
      this.messages.push(m)
      if (!mine) {
        clearTimeout(this.typers.get(m.sender_id)); this.typers.delete(m.sender_id)
        if (!this.stick) this.newBelow += 1
      }
      this.renderMessages(mine)
      if (!mine) { notifyIncoming({ inCurrentRoom: true }); this.markRead() }
    } else if (!mine) { this.unread.set(m.room_id, (this.unread.get(m.room_id) || 0) + 1); notifyIncoming({ inCurrentRoom: false }) }
    this.touchRoom(m)
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

  /* ---------- voice notes ---------- */
  async startVoice() {
    if (this.rec || !this.currentId) return
    try {
      this.recRoom = this.currentId
      this.rec = await startRecording({ onTick: (ms) => { this.recTime.textContent = fmtDuration(ms) }, onAutoStop: (r) => this.sendVoice(r, this.recRoom) })
      this.composerMain.hidden = true; this.recBar.hidden = false; this.recTime.textContent = '0:00'
    } catch (e) { this.rec = null; toast(e.message, 'error') }
  }
  cancelVoice() {
    if (this.rec) { this.rec.cancel(); this.rec = null }
    this.composerMain.hidden = false; this.recBar.hidden = true
  }
  async finishVoice() {
    const rec = this.rec, room = this.recRoom
    if (!rec) return
    this.rec = null
    this.composerMain.hidden = false; this.recBar.hidden = true
    const r = await rec.stop()
    if (!r) return toast('That was too short - hold on a little longer.', 'info')
    this.sendVoice(r, room)
  }
  async sendVoice(r, roomId) {
    if (!r) return
    if (this.rec) { this.rec = null; this.composerMain.hidden = false; this.recBar.hidden = true }
    toast('Sending voice note…')
    const ok = await this.sendFile(r.file, '', roomId, null, r.durationMs)
    if (!ok) toast('Could not send the voice note.', 'error')
  }

  voicePlayer(path, url, ms, name = 'voice-note') {
    // The whole (small) file is downloaded first and played from memory: this avoids the streaming
    // problems some browsers have with voice recordings, and lets us retry with a fresh link.
    const audio = new Audio(); audio.preload = 'auto'
    let loaded = false, loading = null
    const btn = h('button', { class: 'vp-btn', type: 'button', 'aria-label': 'Play voice note' }, icon('play', 18))
    const ico = (n) => btn.replaceChildren(icon(n, 18))
    const fill = h('i'); const bar = h('div', { class: 'vp-bar', role: 'slider', tabIndex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill)
    const time = h('span', { class: 'vp-time' }, fmtDuration(ms))
    const speed = h('button', { class: 'vp-speed', type: 'button', 'aria-label': 'Playback speed' }, '1×')
    const el = h('div', { class: 'voice' }, btn, h('div', { class: 'vp-mid' }, bar, time), speed)
    const total = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : ms)
    const load = () => {
      if (loaded) return Promise.resolve(true)
      if (loading) return loading
      btn.classList.add('loading'); btn.disabled = true
      const grab = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('http ' + r.status); return r.blob() }
      loading = (async () => {
        let blob
        try { blob = await grab(url) } catch { const fresh = await signedUrl('media', path, name); if (!fresh) throw new Error('no link'); blob = await grab(fresh) }
        if (!blob.size) throw new Error('empty')
        audio.src = URL.createObjectURL(blob); loaded = true
        return true
      })().catch(() => { toast('Could not load this voice note. Check your connection and try again.', 'error'); return false })
        .finally(() => { loading = null; btn.disabled = false; btn.classList.remove('loading'); ico(audio.paused ? 'play' : 'pause') })
      return loading
    }
    btn.onclick = async () => {
      if (!audio.paused) return audio.pause()
      if (!(await load())) return
      for (const p of this.players.values()) if (p._audio !== audio) p._audio.pause()
      try { await audio.play() } catch { toast('Could not play this voice note.', 'error') }
    }
    audio.onplay = () => { ico('pause'); btn.setAttribute('aria-label', 'Pause') }
    audio.onpause = () => { ico('play'); btn.setAttribute('aria-label', 'Play voice note') }
    audio.onerror = () => { loaded = false; ico('play'); btn.setAttribute('aria-label', 'Retry'); toast('This voice note could not be played.', 'error') }
    audio.ontimeupdate = () => {
      const t = Math.min(audio.currentTime * 1000, total())
      const p = Math.min(100, (t / total()) * 100); fill.style.width = p + '%'; bar.setAttribute('aria-valuenow', Math.round(p)); time.textContent = fmtDuration(t)
    }
    audio.onended = () => { fill.style.width = '0%'; time.textContent = fmtDuration(ms); ico('play'); audio.currentTime = 0 }
    bar.onclick = async (e) => { if (!(await load())) return; const b = bar.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * total() / 1000 }
    bar.onkeydown = (e) => { if (e.key === 'ArrowRight') audio.currentTime += 5; if (e.key === 'ArrowLeft') audio.currentTime -= 5 }
    speed.onclick = () => { const r = audio.playbackRate === 1 ? 1.5 : audio.playbackRate === 1.5 ? 2 : 1; audio.playbackRate = r; speed.textContent = r + '×' }
    el._audio = audio
    this.players.set(path, el)
    return el
  }

  /* ---------- actions ---------- */
  // Optimistic send: the bubble appears at once (clock icon), then turns into the real message.
  // If the network fails it stays on screen as "Not sent" with Retry / Delete.
  async send() {
    if (!this.currentId) return
    const content = this.input.value.trim()
    if (!content) return
    if (content.length > MAX_LEN) return toast(`Messages are limited to ${MAX_LEN} characters.`, 'error')
    const tmp = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, room_id: this.currentId, sender_id: this.me.id, content,
      created_at: new Date().toISOString(), reply_to: this.replyTo?.id || null, _pending: true }
    this.input.value = ''; this.input.style.height = 'auto'; this.counter.textContent = ''; putDraft(this.currentId, ''); this.syncSendMic(); this.setReply(null)
    if (this.replyTo === null && tmp.reply_to) this.fetchReplyTargets([])    // reply preview comes from the cache
    this.messages.push(tmp)
    this.touchRoom(tmp)
    this.renderMessages(true)
    this.input.focus()
    this.deliver(tmp)
  }

  async deliver(tmp) {
    const { data, error } = await supabase.from('messages')
      .insert({ room_id: tmp.room_id, sender_id: this.me.id, content: tmp.content, ...(tmp.reply_to ? { reply_to: tmp.reply_to } : {}) }).select(MSG_COLS).single()
    if (!this.alive) return
    const i = this.messages.findIndex((x) => x.id === tmp.id)
    if (error) {
      if (i >= 0) { this.messages[i]._pending = false; this.messages[i]._failed = true; if (tmp.room_id === this.currentId) this.renderMessages(false) }
      const msg = friendlyError(error)
      toast(/Network problem/.test(msg) ? 'Message not sent. Check your connection, then tap Retry.' : msg, 'error')
      return
    }
    if (i >= 0) {
      if (this.messages.some((x) => x.id === data.id)) this.messages.splice(i, 1)      // realtime echo got there first
      else this.messages[i] = data
    }
    this.replyCache.set(data.id, data)
    this.touchRoom(data)
    if (tmp.room_id === this.currentId) this.renderMessages(false)
  }

  retrySend(m) {
    const t = this.messages.find((x) => x.id === m.id); if (!t) return
    t._failed = false; t._pending = true; t.created_at = new Date().toISOString()
    this.renderMessages(false); this.deliver(t)
  }
  dropPending(m) { this.messages = this.messages.filter((x) => x.id !== m.id); this.renderMessages(false) }

  lightbox(url, name) {
    const prev = document.activeElement
    const close = () => { document.removeEventListener('keydown', onKey, true); box.remove(); prev?.focus?.() }
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    const closeBtn = h('button', { class: 'lb-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x', 22))
    const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': name || 'Photo', onclick: (e) => { if (e.target === box || e.target.tagName === 'FIGURE') close() } },
      h('div', { class: 'lb-bar' }, h('span', { class: 'lb-name' }, name || ''),
        h('a', { class: 'lb-btn', href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open original in a new tab', title: 'Open original' }, icon('download', 22)), closeBtn),
      h('figure', {}, h('img', { src: url, alt: name || 'Photo', referrerPolicy: 'no-referrer' })))
    document.addEventListener('keydown', onKey, true)
    document.body.append(box); closeBtn.focus()
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

  async sendFile(file, caption, roomId, errEl, durationMs = null) {
    let up = null
    try {
      toast('Uploading…')
      up = await uploadAttachment(roomId, this.me.id, file)
      const { data, error } = await supabase.from('messages').insert({
        room_id: roomId, sender_id: this.me.id, content: caption.slice(0, MAX_LEN),
        attachment_path: up.path, attachment_name: up.name, attachment_type: up.type, attachment_size: up.size,
        ...(durationMs ? { attachment_duration: durationMs } : {}),
        ...(this.replyTo && roomId === this.currentId ? { reply_to: this.replyTo.id } : {}),
      }).select(MSG_COLS).single()
      if (error) throw error
      this.onInsert(data); this.setReply(null)
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
        h('h3', {}, this.nameOf(id)), id !== this.me.id && nickOf(id) && h('p', { class: 'small' }, `@${p.username}`), st && h('p', { class: 'small' }, st),
        id !== this.me.id && nickFor(id) && h('p', { class: 'nick-from' }, icon('heart', 14), ` ${p.username} calls you "${nickFor(id)}"`),
        h('p', { class: 'bio' }, p.bio || 'No bio yet.')),
      id !== this.me.id && personalSection(id, this.nameOf(id), { username: p.username, onNick: () => { this.renderRooms(); this.renderHeader(); this.renderMessages(false); d?.close(); this.showProfile(id) } }),
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

  /* ---------- v0.7: smart tools ---------- */
  async openNotes() {
    try { const id = await getNotesRoom(); await this.loadRooms(); go(`#/chat/${id}`) } catch (e) { toast(friendlyError(e), 'error') }
  }

  roomMenu(r) {
    let d
    const item = (label, fn) => h('button', { class: 'btn block', type: 'button', onclick: () => { d.close(); fn() } }, label)
    d = dialog({ title: this.title(r), body: h('div', { class: 'menu-list' },
      item('Open chat', () => go(`#/chat/${r.id}`)),
      this.flags.has(r.id) ? item('Mark as read', () => this.markRead2(r)) : item('Mark as unread', () => this.markUnread(r))),
    actions: [{ label: 'Close' }] })
  }
  async markUnread(r) {
    try { await setMarkedUnread(r.id, true) } catch (e) { return toast(friendlyError(e), 'error') }
    this.flags.add(r.id)
    if (r.id === this.currentId) { this.currentId = null; this.events.leave(); this.setPaneVisible(false); go('#/chat') }
    this.renderRooms(); toast('Marked as unread', 'success')
  }
  async markRead2(r) {
    this.flags.delete(r.id); this.renderRooms()
    try { await setMarkedUnread(r.id, false) } catch (e) { toast(friendlyError(e), 'error') }
  }

  remindDialog(m) {
    whenDialog({ title: 'Remind me about this message', intro: 'You will get a reminder while LSDK Chat is open (or when you next open it). Only you can see it.',
      confirmLabel: 'Set reminder', onPick: async (when) => { await setReminder(m.id, when); toast('Reminder set', 'success') } })
  }
  async saveMessageDialog(m) {
    let cols = []
    try { cols = [...new Set((await listSaved()).map((x) => x.collection))] } catch { /* ignore */ }
    saveDialog({ collections: cols, onSave: (name) => saveMessage(m.id, name) })
  }
  scheduleDialog() {
    const text = this.input.value.trim()
    const r = this.room(); if (!r) return
    if (!text) return toast('Write a message first, then press the clock button.', 'info')
    const peerName = r.is_direct ? this.nameOf(this.peerOf(r)) : null
    const cb = peerName ? h('input', { type: 'checkbox', id: 'when-online' }) : null
    const extra = peerName ? h('label', { class: 'check', for: 'when-online' }, cb, h('span', {}, ` Instead, send it the next time ${peerName} is online (only works if you both share online status)`)) : null
    whenDialog({ title: 'Send later', intro: 'The message is sent for you at that time, even if you close the app.', extra, confirmLabel: 'Schedule',
      onPick: async (when) => {
        await scheduleMessage({ room: r.id, content: text, at: when, whenOnline: !!cb?.checked, replyTo: this.replyTo?.id })
        this.input.value = ''; this.input.style.height = 'auto'; this.syncSendMic(); this.setReply(null)
        toast(cb?.checked ? `Will send when ${peerName} comes online` : `Scheduled for ${when.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, 'success')
      } })
  }

  /* ---------- dictation ---------- */
  stopDictation() {
    try { this.dictStop?.() } catch { /* ignore */ }
    this.dictStop = null
    if (this.dictBtn) { this.dictBtn.classList.remove('listening'); this.dictBtn.setAttribute('aria-pressed', 'false'); this.dictBtn.title = 'Dictate (speak to type)' }
    if (this.input) this.input.placeholder = 'Write a message…'
  }
  toggleDictation() {
    if (this.dictStop) return this.stopDictation()
    const a = getA11y()
    if (!this.dictNotice) { this.dictNotice = true; toast('Dictation uses your browser\'s speech service, which may send your voice to its maker.', 'info') }
    this.dictBtn.classList.add('listening'); this.dictBtn.setAttribute('aria-pressed', 'true'); this.dictBtn.title = 'Stop dictation'
    this.input.placeholder = 'Listening…'
    this.dictStop = startDictation({
      lang: a.lang,
      onInterim: (t) => { this.input.placeholder = t ? `🎙 ${t}` : 'Listening…' },
      onFinal: (text) => {
        const cmd = getA11y().commands ? commandOf(text) : null
        if (cmd === 'send') { this.stopDictation(); this.send(); return }
        if (cmd === 'clear') { this.input.value = ''; this.syncSendMic(); return }
        if (cmd === 'stop') { this.stopDictation(); return }
        const cur = this.input.value
        this.input.value = (cur + (cur && !/\s$/.test(cur) ? ' ' : '') + text).slice(0, MAX_LEN)
        this.input.dispatchEvent(new Event('input'))
      },
      onEnd: () => { if (this.dictStop) this.stopDictation() },
      onError: (e) => {
        if (e === 'no-speech' || e === 'aborted') return
        toast({ 'not-allowed': 'The microphone is blocked. Allow it in your browser settings.', 'service-not-allowed': 'Your browser does not allow dictation here.',
          'language-not-supported': 'Your browser cannot dictate in that language. Choose another in Settings → Accessibility.', network: 'Dictation needs an internet connection.' }[e] || 'Dictation stopped.', 'error')
        this.stopDictation()
      },
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
      body.append(h('button', { class: 'btn small', type: 'button', onclick: () => { d.close(); this.markUnread(r) } }, 'Mark this chat as unread'))
      if (r.notes_owner) { body.append(h('p', { class: 'small' }, 'This is your private notepad. Only you can see it and nobody can be added. Write reminders, links and drafts here; you can also save files to it.')); return }
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
    d = dialog({ title: r0.notes_owner ? 'Notes to myself' : r0.is_direct ? `Chat with ${this.title(r0)}` : r0.name, body, wide: true, actions: [{ label: 'Close' }] })
    draw()
  }
}
