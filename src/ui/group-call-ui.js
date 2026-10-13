import { h, clear } from '../lib/dom.js'
import { startRingtone, stopRingtone } from '../lib/ringtones.js'
import { fmtDuration } from '../lib/voice.js'
import { icon } from './icons.js'
import { screenShareSupported } from '../lib/calls.js'
import { playWithSound } from './calls-ui.js'
import { toast } from '../lib/dom.js'

// Full-screen window for a group call, driven by GroupCallManager state.
//   incoming -> a ringing card (accept / decline)
//   joining / active -> a grid with one tile per person, plus mute / camera / leave
export class GroupCallOverlay {
  constructor(ctx, mgr) {
    this.ctx = ctx; this.mgr = mgr; this.el = null; this.phase = 'idle'; this.timer = null; this.tiles = new Map()
  }
  roomName(s) { return this.ctx.room?.(s.roomId)?.name || 'Group' }

  update(s) {
    if (s.phase === 'idle') { this.hide(); return }
    if (s.phase === 'incoming' && this.phase !== 'incoming') startRingtone(s.starterId)
    if (s.phase !== 'incoming') stopRingtone()
    if (!this.el) this.build()
    const first = this.phase !== s.phase
    this.phase = s.phase
    this.draw(s, first)
  }

  build() {
    this.prev = document.activeElement
    this.title = h('h2', { class: 'gc-title' })
    this.status = h('div', { class: 'gc-status', 'aria-live': 'polite' })
    this.grid = h('div', { class: 'gc-grid', role: 'list', 'aria-label': 'People in the call' })
    this.center = h('div', { class: 'call-center' })
    this.stageLabel = h('span', { class: 'gc-stage-label' })
    this.stageVideo = h('video', { class: 'gc-stage-video', autoplay: true, playsInline: true })
    this.soundChip = h('button', { class: 'btn small sound-chip', type: 'button', hidden: true, onclick: () => playWithSound(this.stageVideo, this.soundChip) }, icon('volume', 16), ' Tap to hear the shared screen')
    this.stage = h('div', { class: 'gc-stage', hidden: true }, this.stageVideo, this.stageLabel, this.soundChip)
    this.sharing = h('div', { class: 'call-sharing', hidden: true })
    this.controls = h('div', { class: 'call-controls' })
    this.el = h('div', { class: 'call-overlay gc-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Group call', tabIndex: -1 },
      h('div', { class: 'gc-head' }, this.title, this.status), this.stage, this.grid, this.sharing, this.center, this.controls)
    document.body.append(this.el)
    this.el.focus()
  }

  draw(s, first) {
    this.title.textContent = this.roomName(s)
    this.el.classList.toggle('incoming', s.phase === 'incoming')
    clearInterval(this.timer)
    const others = s.members.filter((m) => m.state === 'joined' && m.profile_id !== this.ctx.me.id).length
    const total = others + (s.phase === 'active' ? 1 : 0)
    if (s.phase === 'incoming') this.status.textContent = `Group ${s.kind} call`
    else if (s.phase === 'joining') this.status.textContent = 'Joining…'
    else {
      const tick = () => { this.status.textContent = `${fmtDuration(Date.now() - s.startedAt)} · ${total} in call` }
      tick(); this.timer = setInterval(tick, 1000)
    }
    if (s.phase === 'incoming') { this.drawIncoming(s); this.drawControls(s); return }
    clear(this.center)
    this.drawGrid(s)
    this.drawStage(s)
    this.drawControls(s)
  }

  // someone's shared screen takes the big space; everybody's tiles shrink into a strip
  drawStage(s) {
    const sharer = Object.entries(s.peers || {}).find(([, p]) => p.screen)
    const stream = sharer ? sharer[1].screen : null
    this.el.classList.toggle('has-stage', !!stream)
    this.stage.hidden = !stream
    if (this.stageVideo.srcObject !== (stream || null)) { this.stageVideo.srcObject = stream || null; if (stream) playWithSound(this.stageVideo, this.soundChip); else this.soundChip.hidden = true }
    if (sharer) this.stageLabel.textContent = `${this.ctx.nameOf(sharer[0])}'s screen`
    clear(this.sharing).hidden = !s.screen
    if (s.screen) this.sharing.append(icon('screen', 18), h('span', {}, s.screenAudio ? 'You are sharing your screen and its sound' : 'You are sharing your screen'),
      h('button', { class: 'btn small', type: 'button', onclick: () => this.mgr.stopScreenShare() }, 'Stop'))
  }

  drawIncoming(s) {
    this.grid.hidden = true
    const who = this.ctx.nameOf(s.starterId)
    clear(this.center).append(
      h('div', { class: 'call-avatar' }, this.ctx.avatar(s.starterId, 'xl')),
      h('h2', { class: 'call-name' }, this.roomName(s)),
      h('div', { class: 'call-status' }, `${who} is starting a group ${s.kind} call`))
    this.ctx.hydrateAvatars(this.center)
    this.ctx.ensurePeople([s.starterId]).then(() => { if (this.el && this.phase === 'incoming') this.drawIncoming(this.mgr.s) }).catch(() => {})
  }

  // everyone who is in the call (or ringing) gets a tile
  drawGrid(s) {
    this.grid.hidden = false
    const me = this.ctx.me.id
    const ids = [me, ...s.members.filter((m) => m.profile_id !== me && ['joined', 'ringing'].includes(m.state)).map((m) => m.profile_id)]
    // names and pictures of people we have not loaded yet appear as soon as they arrive
    this.ctx.ensurePeople(ids).then(() => {
      if (!this.el) return
      for (const id of ids) {
        const t = this.tiles.get(id)
        if (!t || t.resolved || !this.ctx.people.has(id)) continue
        t.resolved = true
        t.name.textContent = id === me ? 'You' : this.ctx.nameOf(id)
        clear(t.av).append(this.ctx.avatar(id, 'xl')); this.ctx.hydrateAvatars(t.av)
      }
    }).catch(() => {})
    for (const [id, t] of this.tiles) if (!ids.includes(id)) { t.video.srcObject = null; t.el.remove(); this.tiles.delete(id) }
    this.grid.dataset.n = String(Math.min(ids.length, 6))
    const isVideo = s.kind === 'video'
    for (const id of ids) {
      let t = this.tiles.get(id)
      if (!t) {
        const video = h('video', { class: 'gc-video', autoplay: true, playsInline: true })
        video.muted = id === me
        const av = h('div', { class: 'gc-avatar' }, this.ctx.avatar(id, 'xl'))
        const name = h('span', { class: 'gc-name' }, id === me ? 'You' : this.ctx.nameOf(id))
        const badge = h('span', { class: 'gc-badge' })
        const retry = h('button', { class: 'btn small gc-retry', type: 'button', hidden: true, onclick: () => this.mgr.retryPeer(id) }, 'Try again')
        const el = h('div', { class: 'gc-tile', role: 'listitem' }, av, video, h('div', { class: 'gc-label' }, name, badge), retry)
        this.grid.append(el); this.ctx.hydrateAvatars(el)
        t = { el, video, av, name, badge, retry, resolved: this.ctx.people.has(id) }; this.tiles.set(id, t)
      }
      const joinedPeer = id !== me && s.members.find((m) => m.profile_id === id)?.state === 'joined'
      const peer = s.peers[id]
      const stream = id === me ? s.local : peer?.stream
      if (t.video.srcObject !== (stream || null)) { t.video.srcObject = stream || null; Promise.resolve(t.video.play?.()).catch(() => {}) }
      const liveVideo = !!stream?.getVideoTracks?.().some((tr) => tr.readyState !== 'ended' && !tr.muted && (id !== me || !s.camOff))
      t.el.classList.toggle('has-video', isVideo && liveVideo)
      t.el.classList.toggle('me', id === me)
      t.el.classList.toggle('dim', id !== me && !joinedPeer)
      let badge = ''
      if (id === me) badge = s.muted ? '🔇' : ''
      else if (!joinedPeer) badge = 'Ringing…'
      else if (peer?.state === 'failed') badge = 'Could not connect'
      else if (peer?.state !== 'connected') badge = 'Connecting…'
      t.badge.textContent = badge
      t.retry.hidden = !(joinedPeer && peer?.state === 'failed')
    }
  }

  drawControls(s) {
    const b = (cls, label, icon, fn, on) => h('button', { class: `call-btn ${cls}${on ? ' on' : ''}`, type: 'button', 'aria-label': label, title: label, 'aria-pressed': on == null ? null : String(!!on), onclick: fn }, h('span', { 'aria-hidden': 'true' }, icon))
    clear(this.controls)
    if (s.phase === 'incoming') {
      this.controls.append(b('red', 'Decline', '✖', () => this.mgr.decline()), b('green', 'Join call', '✔', () => this.mgr.accept()))
      return
    }
    if (s.phase === 'joining') { this.controls.append(b('red hang', 'Cancel', '☎', () => this.mgr.hangup())); return }
    this.controls.append(b('', s.muted ? 'Unmute' : 'Mute', s.muted ? '🔇' : '🎤', () => this.mgr.toggleMute(), s.muted))
    const hasCam = !!s.local?.getVideoTracks?.().length
    if (hasCam) this.controls.append(b('', s.camOff ? 'Turn camera on' : 'Turn camera off', s.camOff ? '🚫' : '📷', () => this.mgr.toggleCamera(), s.camOff))
    else if (s.phase === 'active') this.controls.append(b('', 'Switch to video', '📷', () => this.mgr.enableVideo().catch((e) => toast(e.message, 'error'))))
    if (s.phase === 'active' && screenShareSupported()) this.controls.append(b('', s.screen ? 'Stop sharing screen' : 'Share screen', '🖥️',
      () => (s.screen ? Promise.resolve(this.mgr.stopScreenShare()) : this.mgr.startScreenShare()).catch((e) => toast(e.message, 'error')), !!s.screen))
    this.controls.append(b('red hang', 'Leave call', '☎', () => this.mgr.hangup()))
  }

  hide() {
    stopRingtone(); clearInterval(this.timer)
    for (const t of this.tiles.values()) t.video.srcObject = null
    if (this.stageVideo) this.stageVideo.srcObject = null
    this.tiles.clear()
    if (this.el) { this.el.remove(); this.prev?.focus?.() }
    this.el = null; this.phase = 'idle'
  }
}
