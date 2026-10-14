import { h, clear, toast, friendlyError } from '../lib/dom.js'
import { loadCallLog, clearCallLog, screenShareSupported } from '../lib/calls.js'
import { startRingtone, stopRingtone } from '../lib/ringtones.js'
import { fmtDuration } from '../lib/voice.js'
import { loadGroupCallLog, clearGroupCallLog } from '../lib/group-calls.js'
import { icon } from './icons.js'
import { attachMini, floatVideo } from './mini-window.js'

// Plays a shared screen WITH its sound. Browsers sometimes refuse sound until the person taps; then a chip asks for the tap.
export function playWithSound(video, chip) {
  video.muted = false
  Promise.resolve(video.play?.()).then(() => { if (chip) chip.hidden = true }).catch(() => {
    video.muted = true
    Promise.resolve(video.play?.()).catch(() => {})
    if (chip) chip.hidden = false
  })
}

// Full-screen call window driven by CallManager state.
export class CallOverlay {
  constructor(ctx, mgr) {
    this.ctx = ctx; this.mgr = mgr; this.el = null; this.phase = 'idle'; this.timer = null; this.mini = false
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
    this.screenView = h('video', { class: 'call-screen', autoplay: true, playsInline: true })
    this.soundChip = h('button', { class: 'btn small sound-chip', type: 'button', hidden: true, onclick: () => playWithSound(this.screenView, this.soundChip) }, icon('volume', 16), ' Tap to hear the shared screen')
    this.sharing = h('div', { class: 'call-sharing', hidden: true })
    this.controls = h('div', { class: 'call-controls' })
    this.el = h('div', { class: 'call-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Call', tabIndex: -1 },
      this.remote, this.screenView, this.soundChip, this.local, this.sharing, h('div', { class: 'call-center' }, this.avatarBox, this.name, this.status), this.controls)
    this.minBtn = h('button', { class: 'call-min', type: 'button', 'aria-label': 'Minimise the call and keep using the app', title: 'Minimise: keep using the app', onclick: () => this.setMini(true) }, icon('minimize', 22))
    this.el.append(this.minBtn)
    this.miniApi = attachMini(this.el)
    this.el.addEventListener('dblclick', (e) => { if (this.mini && !e.target.closest('button')) this.setMini(false) })
    document.body.append(this.el)
    this.el.focus()
  }
  setMini(on) {
    this.mini = on
    this.miniApi?.set(on)
    if (this.mgr.s) this.drawControls(this.mgr.s)
    if (!on) this.el?.focus()
  }
  draw(s, first) {
    const peer = s.peerId
    if (first || !this.name.textContent) {
      this.name.textContent = this.ctx.nameOf(peer)
      clear(this.avatarBox).append(this.ctx.avatar(peer, 'xl')); this.ctx.hydrateAvatars(this.avatarBox)
    }
    const active = s.phase === 'active'
    if (s.phase === 'incoming' && this.mini) this.setMini(false)
    this.minBtn.hidden = s.phase === 'incoming' || this.mini
    const video = s.kind === 'video' || s.remoteCam
    this.el.classList.toggle('video', active && (video || !!s.remoteScreen))
    this.el.classList.toggle('has-screen', active && !!s.remoteScreen)
    if (this.screenView.srcObject !== (s.remoteScreen || null)) { this.screenView.srcObject = s.remoteScreen || null; if (s.remoteScreen) playWithSound(this.screenView, this.soundChip); else this.soundChip.hidden = true }
    clear(this.sharing).hidden = !(active && s.screen)
    if (active && s.screen) this.sharing.append(icon('screen', 18), h('span', {}, s.screenAudio ? 'You are sharing your screen and its sound' : 'You are sharing your screen'),
      h('button', { class: 'btn small', type: 'button', onclick: () => this.mgr.stopScreenShare() }, 'Stop'))
    if (s.local && this.local.srcObject !== s.local) this.local.srcObject = s.local
    if (s.remote && this.remote.srcObject !== s.remote) { this.remote.srcObject = s.remote; this.remote.play?.().catch(() => {}) }
    this.local.hidden = !(s.local && s.local.getVideoTracks().length && !s.camOff && active)
    clearInterval(this.timer)
    const label = { outgoing: `Calling… (${s.kind})`, incoming: `Incoming ${s.kind} call`, connecting: 'Connecting…' }[s.phase]
    if (s.phase === 'active') {
      const tick = () => { this.status.textContent = fmtDuration(Date.now() - s.startedAt) }
      tick(); this.timer = setInterval(tick, 1000)
    } else this.status.textContent = label || ''
    this.drawControls(s)
  }
  drawControls(s) {
    const b = (cls, label, ico, fn, on) => h('button', { class: `call-btn ${cls}${on ? ' on' : ''}`, type: 'button', 'aria-label': label, title: label, 'aria-pressed': on == null ? null : String(!!on), onclick: fn }, h('span', { 'aria-hidden': 'true' }, icon(ico, this.mini ? 20 : 26)))
    clear(this.controls)
    if (s.phase === 'incoming') {
      this.controls.append(b('red', 'Decline', 'phone-off', () => this.mgr.decline()), b('green', 'Accept', 'phone', () => this.mgr.accept()))
      return
    }
    this.controls.append(b('', s.muted ? 'Unmute' : 'Mute', s.muted ? 'mic-off' : 'mic', () => this.mgr.toggleMute(), s.muted))
    if (this.mini) {
      this.controls.append(b('', 'Open the call screen', 'expand', () => this.setMini(false)), b('red hang', 'End call', 'phone-off', () => this.mgr.hangup()))
      return
    }
    const active = s.phase === 'active'
    const hasCam = !!s.local?.getVideoTracks().length
    if (hasCam) this.controls.append(b('', s.camOff ? 'Turn camera on' : 'Turn camera off', s.camOff ? 'video-off' : 'video', () => this.mgr.toggleCamera(), s.camOff))
    else if (active) this.controls.append(b('', 'Switch to video', 'video', () => this.mgr.enableVideo().catch((e) => toast(e.message))))
    if (active && screenShareSupported()) this.controls.append(b('', s.screen ? 'Stop sharing screen' : 'Share screen', 'screen',
      () => (s.screen ? Promise.resolve(this.mgr.stopScreenShare()) : this.mgr.startScreenShare()).catch((e) => toast(e.message)), !!s.screen))
    if (active && document.pictureInPictureEnabled) this.controls.append(b('', 'Float the video over other apps', 'pip', () => floatVideo(s.remoteScreen ? this.screenView : this.remote).catch((e) => toast(e.message))))
    if (active && this.ctx.watchWith) this.controls.append(b('', 'Watch together', 'tv', () => this.ctx.watchWith(s.peerId)))
    this.controls.append(b('red hang', 'End call', 'phone-off', () => this.mgr.hangup()))
  }
  hide() {
    stopRingtone(); clearInterval(this.timer)
    this.mini = false; this.miniApi?.destroy(); this.miniApi = null
    if (document.pictureInPictureElement) document.exitPictureInPicture?.().catch(() => {})
    if (this.el) { this.remote.srcObject = null; this.local.srcObject = null; this.screenView.srcObject = null; this.el.remove(); this.prev?.focus?.() }
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
  let rows, groupRows = []
  try { rows = await loadCallLog() } catch (e) { return clear(box).append(h('p', { class: 'hint pad' }, friendlyError(e))) }
  try { groupRows = await loadGroupCallLog() } catch { /* group calls are optional until update-v0.9-group-calls.sql has been run */ }
  await ctx.ensurePeople([...rows.flatMap((r) => [r.caller_id, r.callee_id]), ...groupRows.map((g) => g.group_calls.started_by)])
  clear(box)
  if (!rows.length && !groupRows.length) {
    box.append(h('p', { class: 'hint pad' }, 'No calls yet. Open a chat and tap the phone or camera button. You can call someone once you have both sent each other a message.'))
    return
  }
  box.append(h('div', { class: 'list-title row-between' }, 'Recent calls',
    h('button', { class: 'linkish', type: 'button', onclick: async () => { await clearCallLog(); await clearGroupCallLog(); renderCalls(box, ctx) } }, 'Clear history')))
  const items = [...rows.map((c) => ({ t: c.created_at, c })), ...groupRows.map((g) => ({ t: g.group_calls.created_at, g }))]
    .sort((a, b) => new Date(b.t) - new Date(a.t))
  for (const { c, g } of items) {
    if (g) { box.append(groupRow(g, ctx)); continue }
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

function groupRow(g, ctx) {
  const call = g.group_calls, mine = call.started_by === ctx.me.id
  const name = call.rooms?.name || 'Group'
  const missed = ['missed', 'ringing'].includes(g.state) && !mine
  const state = g.state === 'joined' || g.state === 'left'
    ? (g.joined_at && g.left_at ? fmtDuration(new Date(g.left_at) - new Date(g.joined_at)) : 'In call')
    : g.state === 'declined' ? 'Declined' : g.state === 'missed' ? 'Missed' : g.state === 'ringing' ? 'Ringing' : 'Ended'
  return h('div', { class: 'row-item' },
    h('div', { class: 'row-main' }, h('span', { class: 'avatar md', 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase()),
      h('span', { class: 'row-meta' },
        h('span', { class: `row-name${missed ? ' missed' : ''}` }, name),
        h('span', { class: 'row-sub' }, h('span', { class: `dir ${mine ? 'out' : 'in'}` }, icon(ICON[call.kind], 14)), ` Group · ${mine ? 'Outgoing' : 'Incoming'} · ${state} · ${fmtWhen(call.created_at)}`))),
    h('button', { class: 'btn icon round', type: 'button', title: `Call ${name} again`, 'aria-label': `Call ${name} again`,
      onclick: () => ctx.startGroupCall?.(call.room_id, call.kind) }, icon(ICON[call.kind], 20)))
}
