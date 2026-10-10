import { supabase } from '../lib/supabase.js'
import { h, clear, toast, friendlyError } from '../lib/dom.js'
import { BACKGROUNDS, THEMES, getTheme, setTheme, getBackgroundId, setBackground, getCustomImage, setCustomImage, removeCustomImage, getDim, setDim, backgroundCss } from '../lib/theme.js'
import { soundEnabled, setSoundEnabled } from '../lib/sound.js'
import { typingEnabled, setTypingEnabled } from '../lib/room-events.js'
import { clearCallLog } from '../lib/calls.js'
import { state } from '../lib/state.js'

export async function renderSettings(root) {
  const uid = state.session.user.id
  const { data: priv } = await supabase.from('user_private').select('show_online, show_last_seen, share_stories, read_receipts').eq('id', uid).maybeSingle()
  const P = { online: priv?.show_online ?? true, seen: (priv?.show_last_seen ?? true) && (priv?.show_online ?? true), stories: priv?.share_stories ?? true, receipts: priv?.read_receipts ?? true }
  const msg = h('div', { class: 'msg', role: 'status', 'aria-live': 'polite' })
  const flash = (t, kind = 'success') => { msg.textContent = t; msg.className = `msg ${kind}`; clearTimeout(flash.t); flash.t = setTimeout(() => { msg.textContent = '' }, 2500) }

  const toggle = (id, label, hint, checked, onChange, disabled = false) => {
    const cb = h('input', { id, type: 'checkbox', role: 'switch', checked, disabled })
    cb.addEventListener('change', () => onChange(cb))
    return { cb, el: h('label', { class: 'switch-row', for: id }, h('span', { class: 'switch-text' }, h('strong', {}, label), h('small', { class: 'block' }, hint)), cb, h('span', { class: 'switch', 'aria-hidden': 'true' })) }
  }
  const rpc = async (fn, args, ok = 'Saved') => { const { error } = await supabase.rpc(fn, args); if (error) { flash(friendlyError(error), 'error'); return false } flash(ok); return true }

  /* ----- privacy (saved in the database, enforced there) ----- */
  const online = toggle('s-online', 'Show when I am online', 'People you share a chat with can see a green dot.', P.online, async (cb) => {
    const ok = await rpc('set_privacy', { p_online: cb.checked, p_last_seen: seen.cb.checked })
    if (!ok) { cb.checked = !cb.checked; return }
    seen.cb.disabled = !cb.checked; if (!cb.checked) seen.cb.checked = false
  })
  const seen = toggle('s-seen', 'Show my "last seen"', 'Turning online off also hides last seen. If you hide yours, you cannot see theirs either.', P.seen, async (cb) => {
    if (!(await rpc('set_privacy', { p_online: online.cb.checked, p_last_seen: cb.checked }))) cb.checked = !cb.checked
  }, !P.online)
  const receipts = toggle('s-receipts', 'Read receipts ("Seen")', 'If off, others cannot see when you read their messages, and you cannot see theirs.', P.receipts, async (cb) => {
    if (!(await rpc('set_read_receipts', { p_on: cb.checked }))) cb.checked = !cb.checked
  })
  const typing = toggle('s-typing', 'Typing bubbles', 'Show and send "typing…" bubbles. Saved on this device only.', typingEnabled(), (cb) => { setTypingEnabled(cb.checked); flash('Saved') })
  const stories = toggle('s-stories', 'Share my status updates', 'If off, nobody but you can see your status updates.', P.stories, async (cb) => {
    if (!(await rpc('set_story_sharing', { p_on: cb.checked }))) cb.checked = !cb.checked
  })
  const sound = toggle('s-sound', 'Sounds', 'Message ding and call ringtone while the app is open. Saved on this device only.', soundEnabled(), (cb) => { setSoundEnabled(cb.checked); flash('Saved') })

  /* ----- appearance (this device only) ----- */
  const themeRow = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' })
  const drawTheme = () => { clear(themeRow); for (const t of THEMES) themeRow.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(getTheme() === t.id), class: getTheme() === t.id ? 'on' : '', onclick: () => { setTheme(t.id); drawTheme() } }, t.name)) }
  drawTheme()

  const preview = h('div', { class: 'bg-preview', 'aria-hidden': 'true' },
    h('div', { class: 'bubble pv other' }, 'Hey! How is it going?'), h('div', { class: 'bubble pv own' }, 'Looking good 😊'))
  const grid = h('div', { class: 'bg-grid', role: 'radiogroup', 'aria-label': 'Chat background' })
  const dimBox = h('div', { class: 'field' })
  const paint = () => { preview.style.background = backgroundCss(); preview.dataset.dark = getBackgroundId() === 'custom' || BACKGROUNDS.find((b) => b.id === getBackgroundId())?.dark ? '1' : '' }
  const drawGrid = () => {
    clear(grid)
    for (const b of BACKGROUNDS) {
      const sw = h('button', { type: 'button', role: 'radio', class: `bg-sw${getBackgroundId() === b.id ? ' on' : ''}`, 'aria-checked': String(getBackgroundId() === b.id), 'aria-label': b.name, title: b.name, onclick: () => { setBackground(b.id); drawGrid(); paint() } }, h('span', {}, b.name))
      sw.style.background = backgroundCss(b.id); grid.append(sw)
    }
    if (getCustomImage()) {
      const sw = h('button', { type: 'button', role: 'radio', class: `bg-sw${getBackgroundId() === 'custom' ? ' on' : ''}`, 'aria-checked': String(getBackgroundId() === 'custom'), 'aria-label': 'My picture', onclick: () => { setBackground('custom'); drawGrid(); paint() } }, h('span', {}, 'My picture'))
      sw.style.background = backgroundCss('custom', 0); grid.append(sw)
    }
    clear(dimBox)
    if (getBackgroundId() === 'custom') {
      const r = h('input', { id: 'dim', type: 'range', min: 0, max: 60, value: getDim(), 'aria-label': 'Darken picture' })
      r.addEventListener('input', () => { setDim(Number(r.value)); paint() })
      dimBox.append(h('label', { for: 'dim' }, 'Darken my picture (helps text stand out)'), r)
    }
  }
  const pic = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': 'Choose a background picture',
    onchange: async () => {
      const f = pic.files[0]; pic.value = ''
      if (!f) return
      try { await setCustomImage(f); drawGrid(); paint(); flash('Background set') } catch (e) { flash(e.message, 'error') }
    } })
  drawGrid(); paint()

  clear(root).append(h('main', { class: 'doc' },
    h('p', {}, h('a', { href: '#/chat' }, '← Back to chats')),
    h('h1', {}, 'Settings'), msg,
    h('section', {}, h('h2', {}, 'Account'),
      h('p', {}, h('strong', {}, state.profile.username), ' · ', state.session.user.email),
      h('a', { class: 'btn', href: '#/profile' }, 'Edit profile, password, data and account')),
    h('section', {}, h('h2', {}, 'Privacy'), online.el, seen.el, receipts.el, typing.el, stories.el,
      h('p', { class: 'small' }, 'Online, last seen, read receipts and status sharing are enforced by the database, not just hidden in the app. Only people who share a chat with you are ever affected.')),
    h('section', {}, h('h2', {}, 'Appearance'),
      h('div', { class: 'field' }, h('label', {}, 'Theme'), themeRow),
      h('div', { class: 'field' }, h('label', {}, 'Chat background'), preview, grid,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => pic.click() }, '🖼 Use my own picture'), pic,
          h('button', { class: 'btn', type: 'button', onclick: () => { removeCustomImage(); drawGrid(); paint() } }, 'Remove my picture'))),
      dimBox,
      h('p', { class: 'small' }, 'Backgrounds and your picture are stored only on this device (in this browser). Nothing is uploaded, and other people do not see your background.')),
    h('section', {}, h('h2', {}, 'Notifications'), sound.el),
    h('section', {}, h('h2', {}, 'Calls'),
      h('p', { class: 'small' }, 'Call history is kept for 90 days. Clearing it hides it from you; the other person keeps their own copy until they clear it.'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const { error } = await clearCallLog(); error ? toast(friendlyError(error), 'error') : toast('Call history cleared', 'success') } }, 'Clear my call history')),
    h('section', {}, h('h2', {}, 'Legal'), h('p', { class: 'small' },
      h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms'), ' · ', h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy'), ' · ', h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'Disclosures'))),
    h('section', {}, h('button', { class: 'btn', type: 'button', onclick: () => supabase.auth.signOut() }, 'Sign out'))))
}
