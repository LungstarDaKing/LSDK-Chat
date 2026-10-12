import { h, clear, toast, friendlyError } from '../lib/dom.js'
import { loadCallLog, clearCallLog } from '../lib/calls.js'
import { startRingtone, stopRingtone } from '../lib/ringtones.js'
import { fmtDuration } from '../lib/voice.js'
import { icon } from './icons.js'

// Full-screen call window driven by CallManager state.
export class CallOverlay {
  constructor(ctx, mgr) {
    this.ctx = ctx; this.mgr = mgr; this.el = null; this.phase = 'idle'; this.timer = null
  }
  update(s) {
    if (s.phase === 'idle') { this.hide(); return }
    if (s.phase === 'incoming' && this.phase !== 'incoming') startRingtone(s.peerId)
    if (s.phase !== 'incoming') stopRingtone()
    if (!this.el) this.build()
    const first = this.phase !== s.phase
    this.phase = s.phase
    this.draw(s, first)
  }
  build() {
    this.prev = document.activeElement
    this.status = h('div', { class: 'call-status', 'aria-live': 'polite' })
    this.name = h('h2', { class: 'call-name' })
    this.avatarBox = h('div', { class: 'call-avatar' })
    this.remote = h('video', { class: 'call-remote', autoplay: true, playsInline: true })
    this.local = h('video', { class: 'call-local', autoplay: true, playsInline: true, muted: true })
    this.local.muted = true
    this.controls = h('div', { class: 'call-controls' })
    this.el = h('div', { class: 'call-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Call', tabIndex: -1 },
      this.remote, this.local, h('div', { class: 'call-center' }, this.avatarBox, this.name, this.status), this.controls)
    document.body.append(this.el)
    this.el.focus()
  }
  draw(s, first) {
    const peer = s.peerId
    if (first || !this.name.textContent) {
      this.name.textContent = this.ctx.nameOf(peer)
      clear(this.avatarBox).append(this.ctx.avatar(peer, 'xl')); this.ctx.hydrateAvatars(this.avatarBox)
    }
    const video = s.kind === 'video'
    this.el.classList.toggle('video', video && s.phase === 'active')
    if (s.local && this.local.srcObject !== s.local) this.local.srcObject = s.local
    if (s.remote && this.remote.srcObject !== s.remote) { this.remote.srcObject = s.remote; this.remote.play?.().catch(() => {}) }
    this.local.hidden = !(video && s.local && !s.camOff)
    clearInterval(this.timer)
    const label = { outgoing: `Calling… (${s.kind})`, incoming: `Incoming ${s.kind} call`, connecting: 'Connecting…' }[s.phase]
    if (s.phase === 'active') {
      const tick = () => { this.status.textContent = fmtDuration(Date.now() - s.startedAt) }
      tick(); this.timer = setInterval(tick, 1000)
    } else this.status.textContent = label || ''
    this.drawControls(s)
  }
  drawControls(s) {
    const b = (cls, label, ico, fn, on) => h('button', { class: `call-btn ${cls}${on ? ' on' : ''}`, type: 'button', 'aria-label': label, title: label, 'aria-pressed': on == null ? null : String(!!on), onclick: fn }, h('span', { 'aria-hidden': 'true' }, icon(ico, 26)))
    clear(this.controls)
    if (s.phase === 'incoming') {
      this.controls.append(b('red', 'Decline', 'phone-off', () => this.mgr.decline()), b('green', 'Accept', 'phone', () => this.mgr.accept()))
      return
    }
    this.controls.append(b('', s.muted ? 'Unmute' : 'Mute', s.muted ? 'mic-off' : 'mic', () => this.mgr.toggleMute(), s.muted))
    if (s.kind === 'video') this.controls.append(b('', s.camOff ? 'Turn camera on' : 'Turn camera off', s.camOff ? 'video-off' : 'video', () => this.mgr.toggleCamera(), s.camOff))
    this.controls.append(b('red hang', 'End call', 'phone-off', () => this.mgr.hangup()))
  }
  hide() {
    stopRingtone(); clearInterval(this.timer)
    if (this.el) { this.remote.srcObject = null; this.local.srcObject = null; this.el.remove(); this.prev?.focus?.() }
    this.el = null; this.phase = 'idle'
  }
}

const ICON = { voice: 'phone', video: 'video' }
const fmtWhen = (iso) => {
  const d = new Date(iso)
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? `Today, ${t}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${t}`
}

export async function renderCalls(box, ctx) {
  clear(box).append(h('p', { class: 'hint pad' }, 'Loading…'))
  let rows
  try { rows = await loadCallLog() } catch (e) { return clear(box).append(h('p', { class: 'hint pad' }, friendlyError(e))) }
  await ctx.ensurePeople(rows.flatMap((r) => [r.caller_id, r.callee_id]))
  clear(box)
  if (!rows.length) {
    box.append(h('p', { class: 'hint pad' }, 'No calls yet. Open a chat and tap the phone or camera button. You can call someone once you have both sent each other a message.'))
    return
  }
  box.append(h('div', { class: 'list-title row-between' }, 'Recent calls',
    h('button', { class: 'linkish', type: 'button', onclick: async () => { await clearCallLog(); renderCalls(box, ctx) } }, 'Clear history')))
  for (const c of rows) {
    const out = c.caller_id === ctx.me.id, peer = out ? c.callee_id : c.caller_id
    const missed = !out && ['missed', 'declined'].includes(c.status) || (!out && c.status === 'ringing')
    const state = c.status === 'ended' && c.answered_at && c.ended_at ? fmtDuration(new Date(c.ended_at) - new Date(c.answered_at))
      : c.status === 'accepted' ? 'Connected' : c.status === 'busy' ? 'Busy' : c.status === 'declined' ? (out ? 'Declined' : 'Declined') : c.status === 'missed' ? 'Missed' : c.status === 'ringing' ? 'Ringing' : 'Ended'
    box.append(h('div', { class: 'row-item' },
      h('div', { class: 'row-main' }, ctx.avatar(peer, 'md'),
        h('span', { class: 'row-meta' },
          h('span', { class: `row-name${missed ? ' missed' : ''}` }, ctx.nameOf(peer)),
          h('span', { class: 'row-sub' }, h('span', { class: `dir ${out ? 'out' : 'in'}` }, icon(ICON[c.kind], 14)), ` ${out ? 'Outgoing' : 'Incoming'} · ${state} · ${fmtWhen(c.created_at)}`))),
      h('button', { class: 'btn icon round', type: 'button', title: `Call ${ctx.nameOf(peer)} again`, 'aria-label': `Call ${ctx.nameOf(peer)} again`,
        onclick: () => ctx.callPeer(peer, c.kind) }, icon(ICON[c.kind], 20))))
  }
  ctx.hydrateAvatars(box)
}
