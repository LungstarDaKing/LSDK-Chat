import { supabase } from '../lib/supabase.js'
import { h, clear, friendlyError } from '../lib/dom.js'
import { CONFIG } from '../config.js'
import { TERMS_VERSION } from '../version.js'
import { go, refreshProfile } from '../lib/state.js'

// Shown to signed-in users who have not yet accepted the CURRENT terms version
// (existing users after you bump termsVersion, or accounts created before consent existed).
export function renderConsent(root, isUpdate) {
  const msg = h('div', { class: 'msg', role: 'alert' })
  const agree = h('input', { id: 'agree2', type: 'checkbox' })
  const age = h('input', { id: 'age2', type: 'checkbox' })
  const btn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    if (!agree.checked || !age.checked) { msg.textContent = 'Please tick both boxes to continue.'; msg.className = 'msg error'; return }
    btn.disabled = true
    const { error } = await supabase.rpc('accept_terms', { p_version: TERMS_VERSION })
    if (error) { btn.disabled = false; msg.textContent = friendlyError(error); msg.className = 'msg error'; return }
    await refreshProfile()
    go('#/chat')
  } }, 'Accept and continue')

  clear(root).append(h('main', { class: 'center-card' },
    h('h1', {}, isUpdate ? 'We updated our terms' : 'Before you continue'),
    h('p', {}, 'Please review the documents below. You need to accept them to use ', CONFIG.appName, '.'),
    h('ul', { class: 'plain' },
      h('li', {}, h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms of Use')),
      h('li', {}, h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy Policy')),
      h('li', {}, h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'Important disclosures (beta, no end-to-end encryption, etc.)'))),
    h('label', { class: 'check', for: 'age2' }, age, ` I am ${CONFIG.minAge} or older.`),
    h('label', { class: 'check', for: 'agree2' }, agree, ' I have read and accept the Terms of Use, Privacy Policy and disclosures.'),
    msg,
    h('div', { class: 'row' }, btn,
      h('button', { class: 'btn', type: 'button', onclick: () => supabase.auth.signOut() }, 'Decline and sign out')),
    h('p', { class: 'small' }, `Version ${TERMS_VERSION}. If you decline, you can still `, h('a', { href: '#/profile' }, 'download your data or delete your account'), '.'),
  ))
}
