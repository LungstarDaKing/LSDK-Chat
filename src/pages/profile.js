import { supabase } from '../lib/supabase.js'
import { h, clear, toast, dialog, friendlyError } from '../lib/dom.js'
import { CONFIG } from '../config.js'
import { TERMS_VERSION } from '../version.js'
import { state, go, refreshProfile, setFlash } from '../lib/state.js'
import { setAvatar, pruneAvatars, signedUrl, listFiles, removeFiles } from '../lib/media.js'
import { stopHeartbeat } from '../lib/status.js'

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/
const BIO_MAX = 160

async function allMyMessages(userId) {
  const rows = []
  for (let from = 0; from < 50000; from += 1000) {          // pages of 1000
    const { data, error } = await supabase.from('messages')
      .select('id, room_id, content, created_at, edited_at, attachment_name, attachment_type, attachment_size, attachment_path')
      .eq('sender_id', userId).order('created_at').range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

async function downloadMyData() {
  const user = state.session.user
  const messages = await allMyMessages(user.id)
  const { data: memberships, error: e2 } = await supabase.from('participants')
    .select('role, joined_at, rooms(id, name, is_direct)').eq('profile_id', user.id)
  if (e2) throw e2
  const { data: priv } = await supabase.from('user_private').select('show_online, show_last_seen, last_seen_at, share_stories, read_receipts').eq('id', user.id).maybeSingle()
  const { data: myStories } = await supabase.from('stories').select('id, kind, content, attachment_name, created_at, expires_at').eq('author_id', user.id)
  const { data: myCalls } = await supabase.from('calls').select('caller_id, callee_id, kind, status, created_at, answered_at, ended_at')
  const { data: myComments } = await supabase.from('story_comments').select('story_id, content, created_at').eq('user_id', user.id)
  const { data: myReactions } = await supabase.from('message_reactions').select('message_id, emoji, created_at').eq('user_id', user.id)
  const { data: mySaved } = await supabase.from('saved_items').select('message_id, collection, created_at')
  const { data: myReminders } = await supabase.from('message_reminders').select('message_id, remind_at')
  const { data: myScheduled } = await supabase.from('scheduled_messages').select('room_id, content, send_at, when_online, status, created_at')
  const out = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    profile: state.profile,
    presence_settings: priv,
    rooms: memberships,
    status_updates_you_posted: myStories,
    call_history: myCalls,
    status_comments_you_wrote: myComments,
    message_reactions_you_gave: myReactions,
    saved_messages: mySaved,
    message_reminders: myReminders,
    scheduled_messages: myScheduled,
    messages_you_sent: messages.map(({ attachment_path, ...m }) => m),
    note: 'Files you sent (photos, videos, audio, PDFs) and your profile picture are not inside this JSON file; save them from the chats before deleting your account if you want to keep them.',
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
  const a = h('a', { href: url, download: `lsdkchat-data-${new Date().toISOString().slice(0, 10)}.json` })
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Delete every file this person uploaded BEFORE the account itself is removed.
async function deleteMyFiles(userId) {
  const paths = new Set((await allMyMessages(userId)).map((m) => m.attachment_path).filter(Boolean))
  const { data: rooms, error } = await supabase.from('participants').select('room_id').eq('profile_id', userId)
  if (error) throw error
  for (const r of rooms) for (const p of await listFiles('media', `${r.room_id}/${userId}`)) paths.add(p)
  if (paths.size) await removeFiles('media', [...paths])
  const sf = await listFiles('stories', userId)
  if (sf.length) await removeFiles('stories', sf)
  await pruneAvatars(userId, null)
}

export async function renderProfile(root) {
  const p = state.profile
  const user = state.session.user

  const setMsg = (el, t, kind = 'error') => { el.textContent = t; el.className = `msg ${t ? kind : ''}` }

  /* --- picture --- */
  const pic = h('span', { class: 'avatar xl', 'aria-hidden': 'true' }, p.username.slice(0, 1).toUpperCase())
  const picMsg = h('div', { class: 'msg', role: 'alert' })
  const showPic = async () => {
    if (!state.profile.avatar_path) { pic.textContent = state.profile.username.slice(0, 1).toUpperCase(); return }
    const url = await signedUrl('avatars', state.profile.avatar_path)
    if (url) { pic.textContent = ''; pic.append(h('img', { src: url, alt: '' })) }
  }
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': 'Choose a profile picture',
    onchange: async () => {
      const f = file.files[0]; file.value = ''
      if (!f) return
      setMsg(picMsg, 'Uploading…', 'success')
      try {
        const path = await setAvatar(user.id, f)
        await pruneAvatars(user.id, path)
        await refreshProfile(); await showPic(); setMsg(picMsg, 'Profile picture updated.', 'success')
      } catch (e) { setMsg(picMsg, friendlyError(e)) }
    } })
  const removePic = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try {
      const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', user.id)
      if (error) throw error
      await pruneAvatars(user.id, null); await refreshProfile(); await showPic(); setMsg(picMsg, 'Picture removed.', 'success')
    } catch (e) { setMsg(picMsg, friendlyError(e)) }
  } }, 'Remove picture')

  /* --- bio / username --- */
  const uname = h('input', { id: 'uname', value: p.username, minLength: 3, maxLength: 20, pattern: '[A-Za-z0-9_]{3,20}', autocomplete: 'username' })
  const bio = h('textarea', { id: 'bio', rows: 3, maxLength: BIO_MAX, placeholder: 'A few words about you (optional)' })
  bio.value = p.bio || ''
  const bioCount = h('small', {}, `${bio.value.length}/${BIO_MAX}`)
  bio.addEventListener('input', () => { bioCount.textContent = `${bio.value.length}/${BIO_MAX}` })
  const unameMsg = h('div', { class: 'msg', role: 'alert' })

  /* --- password --- */
  const pw = h('input', { id: 'pw', type: 'password', minLength: 10, maxLength: 128, autocomplete: 'new-password' })
  const pwMsg = h('div', { class: 'msg', role: 'alert' })

  const hasConsent = p.terms_version === TERMS_VERSION
  clear(root).append(h('main', { class: 'doc' },
    h('p', {}, h('a', { href: '#/chat' }, hasConsent ? 'Back to chats' : 'Back')),
    h('h1', {}, 'Profile'),

    h('section', {}, h('h2', {}, 'Profile picture'),
      h('div', { class: 'row' }, pic,
        h('div', {}, h('button', { class: 'btn primary', type: 'button', onclick: () => file.click() }, 'Choose picture'), ' ', removePic)),
      file, picMsg,
      h('p', { class: 'small' }, 'Visible to all signed-in users. It is cropped to a square and re-saved at a small size (location data in the photo is removed).')),

    h('section', {}, h('h2', {}, 'Username and bio'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); setMsg(unameMsg, '')
        const v = uname.value.trim()
        if (!USERNAME_RE.test(v)) return setMsg(unameMsg, 'Use 3-20 letters, numbers or underscores.')
        const b = bio.value.trim()
        if (b.length > BIO_MAX) return setMsg(unameMsg, `Bio is limited to ${BIO_MAX} characters.`)
        const { error } = await supabase.from('profiles').update({ username: v, bio: b || null }).eq('id', user.id)
        if (error) return setMsg(unameMsg, /duplicate|23505/.test(error.message) ? 'That username is taken.' : friendlyError(error))
        await refreshProfile(); setMsg(unameMsg, 'Saved.', 'success')
      } },
      h('div', { class: 'field' }, h('label', { for: 'uname' }, 'Username'), uname),
      h('div', { class: 'field' }, h('label', { for: 'bio' }, 'Bio'), bio, bioCount),
      h('p', { class: 'small' }, 'Both are visible to all signed-in users.'),
      unameMsg, h('button', { class: 'btn primary', type: 'submit' }, 'Save'))),

    h('p', { class: 'small' }, 'Online, last seen, read receipts, backgrounds and sounds are in ', h('a', { href: '#/settings' }, 'Settings'), '.'),

    h('section', {}, h('h2', {}, 'Account'),
      h('p', {}, h('strong', {}, 'Email: '), user.email),
      h('p', { class: 'small' }, p.terms_version
        ? `Accepted terms version ${p.terms_version}${p.terms_accepted_at ? ' on ' + new Date(p.terms_accepted_at).toLocaleString() : ''}.`
        : 'You have not accepted the current terms yet.'),
      h('p', { class: 'small' }, h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms'), ' · ',
        h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy'), ' · ',
        h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'Disclosures'))),

    h('section', {}, h('h2', {}, 'Change password'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); setMsg(pwMsg, '')
        if (pw.value.length < 10) return setMsg(pwMsg, 'At least 10 characters.')
        const { error } = await supabase.auth.updateUser({ password: pw.value })
        if (error) return setMsg(pwMsg, friendlyError(error))
        pw.value = ''; setMsg(pwMsg, 'Password updated.', 'success')
      } }, h('div', { class: 'field' }, h('label', { for: 'pw' }, 'New password'), pw), pwMsg,
      h('button', { class: 'btn', type: 'submit' }, 'Update password'))),

    h('section', {}, h('h2', {}, 'Your data'),
      h('p', {}, 'Download your account details, profile, chat memberships and every message you have sent as a JSON file. (Files you sent are not included.)'),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true
        try { await downloadMyData(); toast('Download started', 'success') } catch (err) { toast(friendlyError(err), 'error') }
        e.currentTarget.disabled = false
      } }, 'Download my data')),

    h('section', {}, h('h2', {}, 'Session'),
      h('button', { class: 'btn', type: 'button', onclick: () => supabase.auth.signOut() }, 'Sign out'), ' ',
      h('button', { class: 'btn', type: 'button', onclick: () => supabase.auth.signOut({ scope: 'global' }) }, 'Sign out everywhere')),

    h('section', { class: 'danger-zone' }, h('h2', {}, 'Delete account'),
      h('p', {}, 'Permanently deletes your account, profile, picture, room memberships, every message you sent and every file you uploaded. This cannot be undone.'),
      h('button', { class: 'btn danger', type: 'button', onclick: () => {
        const confirm = h('input', { id: 'delconfirm', autocomplete: 'off', placeholder: 'DELETE' })
        const err = h('div', { class: 'msg error', role: 'alert' })
        dialog({
          title: 'Delete your account?',
          body: [h('p', {}, 'Type DELETE to confirm.'), confirm, err],
          actions: [
            { label: 'Cancel' },
            { label: 'Delete forever', kind: 'danger', onClick: async () => {
              if (confirm.value.trim() !== 'DELETE') { err.textContent = 'Type DELETE exactly.'; return 'keep-open' }
              err.textContent = ''
              try { await deleteMyFiles(user.id) } catch (e) { err.textContent = 'Could not delete your files, so nothing was deleted: ' + friendlyError(e); return 'keep-open' }
              const { error } = await supabase.rpc('delete_my_account')
              if (error) { err.textContent = friendlyError(error); return 'keep-open' }
              stopHeartbeat()
              await supabase.auth.signOut({ scope: 'local' })
              setFlash('Your account, messages and files have been deleted.', 'success')
              go('#/login')
            } },
          ],
        })
      } }, 'Delete my account')),
  ))
  showPic()
}
