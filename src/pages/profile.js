import { supabase } from '../lib/supabase.js'
import { h, clear, toast, dialog, friendlyError } from '../lib/dom.js'
import { CONFIG } from '../config.js'
import { state, go, refreshProfile, setFlash } from '../lib/state.js'

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

async function downloadMyData() {
  const user = state.session.user
  const messages = []
  for (let from = 0; from < 50000; from += 1000) {          // pages of 1000
    const { data, error } = await supabase.from('messages')
      .select('id, room_id, content, created_at, edited_at').eq('sender_id', user.id)
      .order('created_at').range(from, from + 999)
    if (error) throw error
    messages.push(...data)
    if (data.length < 1000) break
  }
  const { data: memberships, error: e2 } = await supabase.from('participants')
    .select('role, joined_at, rooms(id, name, is_direct)').eq('profile_id', user.id)
  if (e2) throw e2
  const out = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    profile: state.profile,
    rooms: memberships,
    messages_you_sent: messages,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
  const a = h('a', { href: url, download: `lsdkchat-data-${new Date().toISOString().slice(0, 10)}.json` })
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function renderProfile(root) {
  const p = state.profile
  const user = state.session.user

  const uname = h('input', { id: 'uname', value: p.username, minLength: 3, maxLength: 20, pattern: '[A-Za-z0-9_]{3,20}', autocomplete: 'username' })
  const unameMsg = h('div', { class: 'msg', role: 'alert' })
  const pw = h('input', { id: 'pw', type: 'password', minLength: 10, maxLength: 128, autocomplete: 'new-password' })
  const pwMsg = h('div', { class: 'msg', role: 'alert' })
  const setMsg = (el, t, kind = 'error') => { el.textContent = t; el.className = `msg ${t ? kind : ''}` }

  const hasConsent = p.terms_version === CONFIG.termsVersion
  clear(root).append(h('main', { class: 'doc' },
    hasConsent && h('p', {}, h('a', { href: '#/chat' }, '← Back to chats')),
    !hasConsent && h('p', {}, h('a', { href: '#/chat' }, '← Back')),
    h('h1', {}, 'Profile'),

    h('section', {}, h('h2', {}, 'Account'),
      h('p', {}, h('strong', {}, 'Email: '), user.email),
      h('p', { class: 'small' }, p.terms_version
        ? `Accepted terms version ${p.terms_version}${p.terms_accepted_at ? ' on ' + new Date(p.terms_accepted_at).toLocaleString() : ''}.`
        : 'You have not accepted the current terms yet.'),
      h('p', { class: 'small' }, h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms'), ' · ',
        h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy'), ' · ',
        h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'Disclosures'))),

    h('section', {}, h('h2', {}, 'Username'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); setMsg(unameMsg, '')
        const v = uname.value.trim()
        if (!USERNAME_RE.test(v)) return setMsg(unameMsg, 'Use 3-20 letters, numbers or underscores.')
        const { error } = await supabase.from('profiles').update({ username: v }).eq('id', user.id)
        if (error) return setMsg(unameMsg, /duplicate|23505/.test(error.message) ? 'That username is taken.' : friendlyError(error))
        await refreshProfile(); setMsg(unameMsg, 'Saved.', 'success')
      } }, h('div', { class: 'field' }, h('label', { for: 'uname' }, 'Visible to other users'), uname),
      unameMsg, h('button', { class: 'btn primary', type: 'submit' }, 'Save username'))),

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
      h('p', {}, 'Download your account details, room memberships and every message you have sent as a JSON file.'),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true
        try { await downloadMyData(); toast('Download started', 'success') } catch (err) { toast(friendlyError(err), 'error') }
        e.currentTarget.disabled = false
      } }, 'Download my data')),

    h('section', {}, h('h2', {}, 'Session'),
      h('button', { class: 'btn', type: 'button', onclick: () => supabase.auth.signOut() }, 'Sign out'),
      h('button', { class: 'btn', type: 'button', onclick: () => supabase.auth.signOut({ scope: 'global' }) }, 'Sign out everywhere')),

    h('section', { class: 'danger-zone' }, h('h2', {}, 'Delete account'),
      h('p', {}, 'Permanently deletes your account, profile, room memberships and every message you sent. This cannot be undone.'),
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
              const { error } = await supabase.rpc('delete_my_account')
              if (error) { err.textContent = friendlyError(error); return 'keep-open' }
              await supabase.auth.signOut({ scope: 'local' })
              setFlash('Your account and messages have been deleted.', 'success')
              go('#/login')
            } },
          ],
        })
      } }, 'Delete my account')),
  ))
}
