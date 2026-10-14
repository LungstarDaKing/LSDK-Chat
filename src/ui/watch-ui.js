import { h, clear, toast, dialog, friendlyError } from '../lib/dom.js'
import { icon } from './icons.js'
import { PROVIDERS, parseMediaLink, embedUrl, watchApi, YouTubeBridge, expectedPos, matchAction, localChange } from '../lib/watch.js'

const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms'
const frameClass = (provider, id) => ({
  youtube: 'yt', tiktok: 'tt',
  spotify: id.startsWith('track/') || id.startsWith('episode/') ? 'sp' : 'sp big',
  apple: id.includes('?i=') ? 'am' : 'am big',
}[provider])

/* ---------------- the floating player ---------------- */
export class WatchPanel {
  constructor(ctx, controller, roomId, row, { embedBase } = {}) {
    this.ctx = ctx; this.ctl = controller; this.room = roomId; this.me = ctx.me.id; this.row = row; this.receivedAt = Date.now()
    this.embedBase = embedBase; this.mute = 0; this.large = false; this.cd = row.cd; this.dead = false
    this.build()
    this.unlisten = watchApi.listen(roomId, (r) => this.onRow(r), () => this.gone())
    this.poll = setInterval(async () => { try { const r = await watchApi.get(roomId); if (r) this.onRow(r); else this.gone() } catch { /* ignore */ } }, 12000)
    this.mountPlayer()
    this.paint()
  }
  get isController() { return this.row.controllers.includes(this.me) }
  get isHost() { return this.row.host === this.me }
  other() { return this.ctx.peerOf?.(this.ctx.rooms?.find((r) => r.id === this.room)) || this.row.controllers.find((u) => u !== this.me) || this.row.host }

  build() {
    this.title = h('span', { class: 'wp-title' })
    this.frameBox = h('div', { class: 'wp-frame' })
    this.chip = h('button', { class: 'btn small wp-chip', type: 'button', hidden: true, onclick: () => { this.bridge?.play(); this.chip.hidden = true } }, icon('play', 16), ' Tap to join playback')
    this.cdEl = h('div', { class: 'wp-countdown', hidden: true, 'aria-live': 'assertive' })
    this.status = h('p', { class: 'wp-status small', 'aria-live': 'polite' })
    this.actions = h('div', { class: 'wp-actions' })
    this.requests = h('div', { class: 'wp-requests' })
    const head = h('div', { class: 'wp-head' }, icon('tv', 18), this.title,
      h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Bigger or smaller player', title: 'Bigger or smaller', onclick: () => { this.large = !this.large; this.el.classList.toggle('large', this.large) } }, icon(this.large ? 'minimize' : 'expand', 18)),
      h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Close the player (the other person keeps watching)', title: 'Close (you can rejoin from the chat)', onclick: () => this.close() }, icon('x', 18)))
    this.el = h('section', { class: 'watch-panel', role: 'region', 'aria-label': 'Watching together' }, head, h('div', { class: 'wp-stage' }, this.frameBox, this.cdEl, this.chip), this.status, this.requests, this.actions)
    document.body.append(this.el)
    this.drag(head)
  }
  drag(head) {   // the player can be dragged by its title bar on computers; on phones it sits at the top
    let d = null
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || window.innerWidth <= 560) return
      const r = this.el.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; head.setPointerCapture?.(e.pointerId)
    })
    head.addEventListener('pointermove', (e) => {
      if (!d) return
      const r = this.el.getBoundingClientRect()
      const left = Math.max(4, Math.min(window.innerWidth - r.width - 4, e.clientX - d.dx)), top = Math.max(4, Math.min(window.innerHeight - 60, e.clientY - d.dy))
      Object.assign(this.el.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' })
    })
    head.addEventListener('pointerup', () => { d = null }); head.addEventListener('pointercancel', () => { d = null })
  }

  mountPlayer() {
    const { provider, media_id: id } = this.row
    this.provider = provider
    const src = embedUrl(provider, id, { origin: location.origin })
    if (!src) { this.frameBox.textContent = 'This item cannot be shown.'; return }
    const url = provider === 'youtube' && this.embedBase ? src.replace(PROVIDERS.youtube.embed, this.embedBase) : src
    this.frameBox.className = `wp-frame ${frameClass(provider, id)}`
    const f = document.createElement('iframe')
    f.setAttribute('src', url); f.setAttribute('title', `${PROVIDERS[provider].name} player`); f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write')
    f.setAttribute('allowfullscreen', ''); f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); f.setAttribute('sandbox', SANDBOX); f.setAttribute('loading', 'eager')
    this.frameBox.append(f); this.frame = f
    if (provider === 'youtube') {
      this.bridge = new YouTubeBridge(f, { origin: this.embedBase || PROVIDERS.youtube.embed, onReport: (r) => this.onReport(r) })
    }
  }

  /* ----- what the other person did ----- */
  onRow(r) {
    if (this.dead || r.version < this.row.version) return
    const changedMedia = r.provider !== this.row.provider || r.media_id !== this.row.media_id
    const cdUp = r.cd > this.cd; this.cd = r.cd
    this.row = r; this.receivedAt = Date.now()
    if (changedMedia) { this.bridge?.destroy(); this.bridge = null; clear(this.frameBox); this.mountPlayer() }
    else if (this.bridge) this.reconcile()
    if (cdUp) this.countdown()
    this.paint()
  }
  gone() { if (this.dead) return; toast('Watching together ended'); this.close(true) }

  // make our player match the shared state
  reconcile(force = false) {
    if (!this.bridge?.report.ready) return
    const rep = this.bridge.report, want = expectedPos(this.row, this.receivedAt)
    const act = force ? (this.row.playing ? 'seek-play' : 'seek') : matchAction(this.row, this.receivedAt, rep)
    if (act === 'none') return
    this.mute = Date.now() + 1500
    if (act === 'seek' || act === 'seek-play') this.bridge.seek(want)
    if (act === 'play' || act === 'seek-play') { this.bridge.play(); clearTimeout(this.blockT); this.blockT = setTimeout(() => { if (this.row.playing && !this.bridge?.report.playing) this.chip.hidden = false }, 1800) }
    if (act === 'pause') this.bridge.pause()
  }
  // the YouTube player told us something (every fraction of a second)
  onReport(rep) {
    if (this.dead) return
    if (rep.playing) this.chip.hidden = true
    if (!this.reportedReady) { this.reportedReady = true; this.reconcile(true); return }
    if (Date.now() < this.mute) return
    if (this.isController) {
      const ch = localChange(this.row, this.receivedAt, rep)
      if (ch) { this.mute = Date.now() + 1500; watchApi.control(this.room, ch.action, ch.pos).catch((e) => toast(friendlyError(e), 'error')) }
    } else if (matchAction(this.row, this.receivedAt, rep) !== 'none') {
      this.mismatch = this.mismatch || Date.now()
      if (Date.now() - this.mismatch > 1200) { this.mismatch = 0; this.reconcile() }     // the other person is in control: pull back
    } else this.mismatch = 0
  }
  countdown() {
    this.cdEl.hidden = false
    let n = 3; const tick = () => {
      if (this.dead) return
      this.cdEl.textContent = n > 0 ? String(n) : 'Press play now!'
      if (n-- < 0) { setTimeout(() => { this.cdEl.hidden = true }, 1500); return }
      setTimeout(tick, 1000)
    }
    tick()
  }

  /* ----- screen ----- */
  nameOfController() { return this.ctx.nameOf(this.row.host) }
  paint() {
    const r = this.row, p = PROVIDERS[r.provider]
    this.title.textContent = `Watching together · ${p.name}`
    const others = r.controllers.filter((u) => u !== this.me)
    this.status.textContent = this.isController
      ? (this.isHost ? 'You are in control.' : `You can control it. ${this.nameOfController()} started it.`) + (p.synced ? ' Play, pause and jumping are shared.' : '')
      : `${this.ctx.nameOf(r.controllers[0] || r.host)} is in control.${r.requests.includes(this.me) ? ' You asked to control it.' : ''}`
    if (!p.synced) this.status.textContent += ` ${p.name} cannot be remote controlled by a website: use the countdown and both press play together. Full songs need you to be signed in to ${p.name} in this browser; otherwise you hear a short preview.`
    clear(this.requests)
    if (this.isHost) for (const u of r.requests) this.requests.append(h('div', { class: 'wp-request' }, h('span', {}, `${this.ctx.nameOf(u)} wants to control it`),
      h('button', { class: 'btn primary small', type: 'button', onclick: () => this.act(() => watchApi.grant(this.room, u, true)) }, 'Allow'),
      h('button', { class: 'btn small', type: 'button', onclick: () => this.act(() => watchApi.grant(this.room, u, false)) }, 'No')))
    clear(this.actions)
    const b = (label, fn, cls = 'btn small') => h('button', { class: cls, type: 'button', onclick: fn }, label)
    if (p.synced && this.isController) this.actions.append(b(r.playing ? 'Pause for both' : 'Play for both', () => this.act(() => watchApi.control(this.room, r.playing ? 'pause' : 'play', this.bridge?.report.pos ?? r.pos)), 'btn primary small'))
    if (!p.synced && this.isController) this.actions.append(b('3-2-1 play together', () => this.act(() => watchApi.control(this.room, 'countdown')), 'btn primary small'))
    if (p.synced) this.actions.append(b('Sync me', () => this.reconcile(true)))
    if (!this.isController && !r.requests.includes(this.me)) this.actions.append(b('Ask to control', () => this.act(() => watchApi.request(this.room))))
    if (this.isHost && others.length) this.actions.append(b('Take control back', () => this.act(() => watchApi.grant(this.room, others[0], false))))
    if (this.isController) this.actions.append(b('Watch something else', () => this.ctl.startDialog(this.room)))
    this.actions.append(b('Stop for both', () => this.act(async () => { await watchApi.stop(this.room) }), 'btn small danger'))
  }
  async act(fn) { try { await fn(); const r = await watchApi.get(this.room); if (r) this.onRow(r) } catch (e) { toast(friendlyError(e), 'error') } }

  close(ended = false) {
    if (this.dead) return
    this.dead = true; clearInterval(this.poll); clearTimeout(this.blockT); this.unlisten?.(); this.bridge?.destroy()
    this.frameBox.replaceChildren(); this.el.remove(); this.ctl.panelClosed(this, ended)
  }
}

/* ---------------- the button, the banner and starting a session ---------------- */
export class WatchController {
  constructor(ctx) {
    this.ctx = ctx; this.room = null; this.panel = null; this.unlisten = null
    this.btn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Watch together', title: 'Watch together', onclick: () => this.open() }, icon('tv'))
    this.banner = h('div', { class: 'call-banner watch-banner', hidden: true })
  }
  get active() { return !!this.panel }
  get canWatch() { return !!this.room && this.room.is_direct && !this.room.notes_owner }
  setRoom(r) {
    if (this.room?.id === r?.id) return
    this.unlisten?.(); this.unlisten = null; this.room = r; this.banner.hidden = true
    this.btn.hidden = !this.canWatch
    if (!this.canWatch) return
    this.unlisten = watchApi.listen(r.id, (row) => this.paint(row), () => this.paint(null))
    this.refresh()
  }
  destroy() { this.unlisten?.(); this.panel?.close() }
  async refresh() { if (!this.canWatch) return; const id = this.room.id; try { const row = await watchApi.get(id); if (this.room?.id === id) this.paint(row) } catch { /* optional until update-v0.13.sql has been run */ } }
  paint(row) {
    if (!row || row.room_id !== this.room?.id || this.panel) { this.banner.hidden = true; return }
    clear(this.banner).append(h('span', { class: 'cb-text' }, icon('tv', 16), ` Watching together · ${PROVIDERS[row.provider]?.name || ''}`),
      h('button', { class: 'btn primary small', type: 'button', onclick: () => this.openPanel(row) }, 'Join'))
    this.banner.hidden = false
  }
  async open() {
    if (!this.canWatch) return toast('Watching together works in a chat between two people.')
    let row = null
    try { row = await watchApi.get(this.room.id) } catch (e) { return toast(friendlyError(e), 'error') }
    if (row) this.openPanel(row); else this.startDialog(this.room.id)
  }
  openPanel(row, opts) {
    this.panel?.close()
    this.panel = new WatchPanel(this.ctx, this, row.room_id, row, opts)
    this.banner.hidden = true
  }
  panelClosed(p, ended) { if (this.panel === p) this.panel = null; this.refresh(); if (ended) this.ctx.releaseIfDone?.() ; else setTimeout(() => this.ctx.releaseIfDone?.(), 0) }
  startDialog(roomId) {
    const input = h('input', { type: 'url', placeholder: 'Paste a YouTube, Spotify, Apple Music or TikTok link', autocomplete: 'off', 'aria-label': 'Link' })
    const body = h('div', {}, h('p', {}, 'Paste a link. Both of you will see it in a player over the chat.'),
      input, h('ul', { class: 'small wp-help' },
        h('li', {}, 'YouTube: play, pause and jumping stay in step for both of you.'),
        h('li', {}, 'Spotify, Apple Music, TikTok: both see the same item and press play together after a 3-2-1 countdown.'),
        h('li', {}, 'Use headphones in a call, or the other person will hear the sound through your microphone.')))
    dialog({ title: 'Watch together', body, actions: [{ label: 'Cancel' }, { label: 'Start', kind: 'primary', onClick: async () => {
      const r = parseMediaLink(input.value)
      if (r.error) { toast(r.error, 'error'); return 'keep-open' }
      try { await watchApi.start(roomId, r.provider, r.id); this.openPanel(await watchApi.get(roomId)) } catch (e) { toast(friendlyError(e), 'error'); return 'keep-open' }
    } }] })
    setTimeout(() => input.focus(), 0)
  }
}
