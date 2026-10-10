import { supabase, appUrl } from '../lib/supabase.js'
import { h, clear, friendlyError, toast } from '../lib/dom.js'
import { CONFIG } from '../config.js'
import { TERMS_VERSION } from '../version.js'
import { flash, setFlash, go, state } from '../lib/state.js'

const MIN_PASSWORD = 10
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

const legalLinks = () => [
  h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms of Use'), ' and ',
  h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy Policy'),
]

function field(label, input, hint) {
  const id = input.id
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('small', { id: `${id}-hint` }, hint))
}

export function renderAuth(root, mode) {
  const msg = h('div', { class: 'msg', role: 'alert' })
  const show = (text, kind = 'error') => { msg.textContent = text; msg.className = `msg ${text ? kind : ''}` }
  if (flash.message) { show(flash.message, flash.kind); flash.message = null }

  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'email', maxLength: 254, placeholder: 'you@example.com' })
  const password = h('input', {
    id: 'password', type: 'password', required: true, minLength: mode === 'register' ? MIN_PASSWORD : 1,
    autocomplete: mode === 'register' ? 'new-password' : 'current-password', maxLength: 128,
  })
  const username = h('input', { id: 'username', type: 'text', required: true, autocomplete: 'username', minLength: 3, maxLength: 20, pattern: '[A-Za-z0-9_]{3,20}', placeholder: 'e.g. night_owl' })
  const agreeTerms = h('input', { id: 'agree', type: 'checkbox', required: true })
  const agreeAge = h('input', { id: 'age', type: 'checkbox', required: true })
  const submit = h('button', { class: 'btn primary block', type: 'submit' },
    mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in')

  const form = h('form', { novalidate: false, onsubmit: async (e) => {
    e.preventDefault()
    show('')
    submit.disabled = true
    try {
      const em = email.value.trim()
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: password.value })
        if (error) {
          if (/not confirmed/i.test(error.message)) {
            show('Please confirm your email first (check your inbox and spam folder).')
            msg.append(' ', h('button', { type: 'button', class: 'linkish', onclick: async () => {
              const { error: e2 } = await supabase.auth.resend({ type: 'signup', email: em, options: { emailRedirectTo: appUrl() } })
              show(e2 ? friendlyError(e2) : 'Confirmation email sent.', e2 ? 'error' : 'success')
            } }, 'Resend email'))
          } else if (/invalid login/i.test(error.message)) show('Wrong email or password.')
          else show(friendlyError(error))
        }
        // success -> onAuthStateChange routes to chat
      } else if (mode === 'register') {
        if (!USERNAME_RE.test(username.value)) return show('Username must be 3-20 letters, numbers or underscores.')
        if (password.value.length < MIN_PASSWORD) return show(`Password must be at least ${MIN_PASSWORD} characters.`)
        if (!agreeTerms.checked || !agreeAge.checked) return show('You must accept the terms and confirm your age.')
        // Cheap pre-check; the database trigger is still the source of truth.
        const { data, error } = await supabase.auth.signUp({
          email: em, password: password.value,
          options: { emailRedirectTo: appUrl(), data: { username: username.value, terms_version: TERMS_VERSION } },
        })
        if (error) return show(friendlyError(error))
        if (!data.session) {
          clear(form).append(h('div', { class: 'msg success' },
            h('strong', {}, 'Check your email. '),
            'If this address can be registered, a confirmation link is on its way (check spam too). After confirming, come back and sign in.'),
            h('a', { href: '#/login' }, 'Back to sign in'))
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: appUrl() })
        if (error) return show(friendlyError(error))
        show('If an account exists for that address, a reset link has been sent.', 'success')
      }
    } catch (err) { show(friendlyError(err)) } finally { submit.disabled = false }
  } },
    field('Email', email),
    mode === 'register' && field('Username', username, 'Visible to other users. 3-20 letters, numbers or _'),
    mode !== 'forgot' && field('Password', password, mode === 'register' ? `At least ${MIN_PASSWORD} characters` : undefined),
    mode === 'register' && h('label', { class: 'check', for: 'age' }, agreeAge, ` I am ${CONFIG.minAge} or older.`),
    mode === 'register' && h('label', { class: 'check', for: 'agree' }, agreeTerms, ' I have read and agree to the ', ...legalLinks(), '.'),
    msg, submit,
  )

  const links = h('p', { class: 'alt' },
    mode === 'login' && [h('a', { href: '#/register' }, 'Create an account'), ' · ', h('a', { href: '#/forgot' }, 'Forgot password?')],
    mode !== 'login' && h('a', { href: '#/login' }, 'Back to sign in'))

  clear(root).append(h('main', { class: 'center-card' },
    h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, '💬'), h('h1', {}, CONFIG.appName)),
    h('p', { class: 'sub' }, mode === 'register' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Sign in to continue'),
    h('p', { class: 'beta' }, 'Test release - not end-to-end encrypted. Read the ', h('a', { href: '#/disclosures', target: '_blank', rel: 'noopener' }, 'disclosures'), '.'),
    form, links,
    h('footer', { class: 'legal-foot' }, ...legalLinks()),
  ))
  email.focus()
}

export function renderReset(root) {
  const msg = h('div', { class: 'msg', role: 'alert' })
  const pw = h('input', { id: 'npw', type: 'password', required: true, minLength: MIN_PASSWORD, maxLength: 128, autocomplete: 'new-password' })
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Set new password')
  clear(root).append(h('main', { class: 'center-card' },
    h('h1', {}, 'Choose a new password'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true
      const { error } = await supabase.auth.updateUser({ password: pw.value })
      btn.disabled = false
      if (error) { msg.textContent = friendlyError(error); msg.className = 'msg error'; return }
      state.recovering = false
      toast('Password updated.', 'success')
      go('#/chat')
    } }, field('New password', pw, `At least ${MIN_PASSWORD} characters`), msg, btn)))
}
