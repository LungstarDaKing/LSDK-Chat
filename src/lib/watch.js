// Watch together: both people see the same YouTube video, Spotify / Apple Music item or TikTok in one panel.
//   YouTube: play, pause and jumping are kept in step for both people.
//   Spotify, Apple Music, TikTok: those players cannot be remote controlled by a website, so both people see the same
//   item and use a "3-2-1, press play" countdown.
// The database (supabase/update-v0.13.sql) keeps the shared state and decides who may control.
import { supabase } from './supabase.js'

export const PROVIDERS = {
  youtube: { name: 'YouTube', synced: true, embed: 'https://www.youtube-nocookie.com' },
  spotify: { name: 'Spotify', synced: false, embed: 'https://open.spotify.com' },
  apple: { name: 'Apple Music', synced: false, embed: 'https://embed.music.apple.com' },
  tiktok: { name: 'TikTok', synced: false, embed: 'https://www.tiktok.com' },
}
// the same checks the database makes
export const ID_RULES = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  spotify: /^(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{10,30}$/,
  apple: /^\/[a-z]{2}\/(album|playlist|song|artist|music-video|station)\/[A-Za-z0-9_~%-]{1,100}(\/[A-Za-z0-9_~%-]{1,60}){0,2}(\?i=[0-9]{5,15})?$/,
  tiktok: /^[0-9]{5,25}$/,
}
export const validMedia = (provider, id) => !!ID_RULES[provider]?.test(String(id || ''))

// Turns whatever link was pasted into { provider, id } or { error }.
export function parseMediaLink(text) {
  let u
  try { u = new URL(String(text || '').trim()) } catch { return { error: 'Paste a full link that starts with https://' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Paste a full link that starts with https://' }
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)
  const ok = (provider, id) => (validMedia(provider, id) ? { provider, id } : null)
  if (host === 'youtu.be') { const r = ok('youtube', parts[0]); if (r) return r }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v'); const r = ok('youtube', v || (['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : ''))
    if (r) return r
  }
  if (host === 'open.spotify.com') {
    const i = parts.findIndex((p) => ['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(p))
    const r = i >= 0 && ok('spotify', `${parts[i]}/${parts[i + 1]}`); if (r) return r
  }
  if (host === 'music.apple.com') {
    const path = u.pathname.replace(/\/+$/, ''); const i = u.searchParams.get('i')
    const r = ok('apple', path + (i ? `?i=${i}` : '')); if (r) return r
  }
  if (host === 'tiktok.com') {
    const i = parts.indexOf('video'); const r = i >= 0 && ok('tiktok', parts[i + 1]); if (r) return r
  }
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com' || (host === 'tiktok.com' && parts[0] === 't')) return { error: 'TikTok short links do not work. Open the video, tap Share, Copy link, and paste the long link that contains /video/ and a number.' }
  return { error: 'That link is not supported. Paste a YouTube, Spotify, Apple Music or TikTok link.' }
}

// the address that goes into the player frame (only built from a checked id, never from raw text)
export function embedUrl(provider, id, { origin = '' } = {}) {
  if (!validMedia(provider, id)) return null
  const base = PROVIDERS[provider].embed
  if (provider === 'youtube') return `${base}/embed/${id}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(origin)}`
  if (provider === 'spotify') return `${base}/embed/${id}`
  if (provider === 'apple') return `${base}${id}`
  return `${base}/embed/v2/${id}`
}

let listenerCount = 0
const ok = ({ data, error }) => { if (error) throw error; return data }
export const watchApi = {
  start: async (room, provider, id) => ok(await supabase.rpc('watch_start', { p_room: room, p_provider: provider, p_media: id })),
  control: async (room, action, pos = 0) => ok(await supabase.rpc('watch_control', { p_room: room, p_action: action, p_pos: pos })),
  request: async (room) => ok(await supabase.rpc('watch_request', { p_room: room })),
  grant: async (room, user, allow) => ok(await supabase.rpc('watch_grant', { p_room: room, p_user: user, p_allow: allow })),
  stop: async (room) => ok(await supabase.rpc('watch_stop', { p_room: room })),
  get: async (room) => ok(await supabase.from('watch_sessions').select('*').eq('room_id', room).maybeSingle()),
  listen(room, onRow, onGone) {
    // Every listener needs its OWN channel name. The banner and the player both listen to the same room; sharing one
    // name made the second one throw while the player was being built (empty player that could not be closed).
    const ch = supabase.channel(`watch-${room}-${++listenerCount}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watch_sessions', filter: `room_id=eq.${room}` }, (p) => (p.eventType === 'DELETE' ? onGone() : p.new && onRow(p.new)))
      .subscribe()
    return () => supabase.removeChannel(ch)
  },
}

/* ---------- keeping two YouTube players in step (pure decisions, so they can be tested) ---------- */
export const DRIFT_SECONDS = 2.5
// Where the shared video should be right now, given the last row and how long ago we received it.
export const expectedPos = (row, receivedAt, now = Date.now()) => row.pos + (row.playing ? Math.max(0, (now - receivedAt) / 1000) : 0)
// What to do about a player report { playing, pos } compared with the shared state
//   'none' | 'seek' | 'play' | 'pause'  (what THIS player should do to match the shared state)
export function matchAction(row, receivedAt, report, now = Date.now()) {
  const want = expectedPos(row, receivedAt, now)
  if (row.playing && !report.playing) return Math.abs(report.pos - want) > DRIFT_SECONDS ? 'seek-play' : 'play'
  if (!row.playing && report.playing) return 'pause'
  if (Math.abs(report.pos - want) > DRIFT_SECONDS) return 'seek'
  return 'none'
}
// A person with control used the player's own buttons: what should we tell the others?
export function localChange(row, receivedAt, report, now = Date.now()) {
  const want = expectedPos(row, receivedAt, now)
  if (report.playing !== row.playing) return { action: report.playing ? 'play' : 'pause', pos: report.pos }
  if (Math.abs(report.pos - want) > DRIFT_SECONDS) return { action: 'seek', pos: report.pos }
  return null
}

/* ---------- YouTube player bridge (talks to the frame with postMessage; no extra script is loaded) ---------- */
export class YouTubeBridge {
  constructor(frame, { origin = PROVIDERS.youtube.embed, onReport }) {
    this.frame = frame; this.origin = origin; this.onReport = onReport; this.report = { playing: false, pos: 0, ready: false }
    this.onMsg = (e) => {
      if (e.origin !== this.origin || e.source !== this.frame.contentWindow) return
      let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
      if (!d || typeof d !== 'object') return
      const info = d.info
      if (d.event === 'onReady') this.report.ready = true
      if (d.event === 'onStateChange' && typeof info === 'number') this.report.playing = info === 1 || info === 3
      if ((d.event === 'infoDelivery' || d.event === 'initialDelivery') && info && typeof info === 'object') {
        this.report.ready = true
        if (typeof info.currentTime === 'number') this.report.pos = info.currentTime
        if (typeof info.playerState === 'number') this.report.playing = info.playerState === 1 || info.playerState === 3
      }
      this.onReport?.({ ...this.report })
    }
    window.addEventListener('message', this.onMsg)
    // keep asking until the player answers, so we hear about its state
    const hello = () => this.post({ event: 'listening', id: 1, channel: 'widget' })
    frame.addEventListener('load', () => { hello(); this.helloT = setInterval(() => { if (this.report.ready) clearInterval(this.helloT); else hello() }, 700) })
  }
  post(msg) { try { this.frame.contentWindow?.postMessage(JSON.stringify(msg), this.origin) } catch { /* ignore */ } }
  cmd(func, args = []) { this.post({ event: 'command', func, args }) }
  play() { this.cmd('playVideo') } pause() { this.cmd('pauseVideo') } seek(s) { this.cmd('seekTo', [s, true]) }
  destroy() { window.removeEventListener('message', this.onMsg); clearInterval(this.helloT) }
}
