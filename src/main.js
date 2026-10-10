import './styles.css'
import { supabase } from './lib/supabase.js'
import { h, clear } from './lib/dom.js'
import { CONFIG } from './config.js'
import { TERMS_VERSION } from './version.js'
import { state, flash, setFlash, go, refreshProfile } from './lib/state.js'
import { renderAuth, renderReset } from './pages/auth.js'
import { renderChat, teardownChat } from './pages/chat.js'
import { renderProfile } from './pages/profile.js'
import { renderLegal } from './pages/legal.js'
import { renderConsent } from './pages/consent.js'
import { startHeartbeat, stopHeartbeat } from './lib/status.js'

// Clickjacking protection (GitHub Pages cannot send X-Frame-Options / frame-ancestors).
if (window.top !== window.self) {
  document.body.textContent = 'This app cannot be shown inside another page.'
  throw new Error('framed')
}

const root = document.getElementById('app')

// NOTE: never await Supabase calls inside this callback (deadlocks supabase-js); defer instead.
supabase.auth.onAuthStateChange((event, s) => {
  state.session = s
  if (event === 'PASSWORD_RECOVERY') state.recovering = true
  if (event === 'SIGNED_OUT') { state.profile = null; state.recovering = false; teardownChat(); stopHeartbeat() }
  if (['SIGNED_IN', 'SIGNED_OUT', 'PASSWORD_RECOVERY'].includes(event)) setTimeout(route, 0)
})

const PUBLIC = new Set(['login', 'register', 'forgot', 'terms', 'privacy', 'disclosures'])

async function route() {
  const [name = '', arg] = (location.hash.replace(/^#\/?/, '') || '').split('/')
  const legal = ['terms', 'privacy', 'disclosures'].includes(name)

  if (state.recovering && state.session) { teardownChat(); return renderReset(root) }
  if (legal) { teardownChat(); return renderLegal(root, name, !!state.session) }

  if (!state.session) {
    teardownChat()
    if (!PUBLIC.has(name)) return go('#/login')
    return renderAuth(root, name === 'register' ? 'register' : name === 'forgot' ? 'forgot' : 'login')
  }

  // Signed in from here on.
  if (!state.profile) {
    try { await refreshProfile() } catch (e) { return renderFatal(e) }
  }
  // Profile page (data export + account deletion) stays reachable even before terms are accepted.
  if (name === 'profile' && state.profile) { teardownChat(); return renderProfile(root) }
  if (!state.profile || state.profile.terms_version !== TERMS_VERSION) {
    teardownChat()
    return renderConsent(root, !!state.profile?.terms_version)
  }
  startHeartbeat()
  if (['login', 'register', 'forgot', ''].includes(name)) return go('#/chat')
  if (name === 'profile') { teardownChat(); return renderProfile(root) }
  if (name === 'chat') return renderChat(root, arg || null)
  return go('#/chat')
}

function renderFatal(e) {
  clear(root).append(h('main', { class: 'center-card' },
    h('h1', {}, 'Something went wrong'),
    h('p', {}, 'We could not load your account. Check your connection and reload.'),
    h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'),
  ))
  console.error(e)
}

async function start() {
  // Waits for the ?code= exchange (email confirmation / password reset links).
  const { data } = await supabase.auth.getSession()
  state.session = data.session
  const q = new URLSearchParams(location.search)
  const hq = new URLSearchParams(location.hash.includes('error') ? location.hash.replace(/^#\/?/, '') : '')
  const urlError = q.get('error_description') || hq.get('error_description')
  if (q.has('code') || q.has('error') || urlError) {
    history.replaceState(null, '', location.pathname + (urlError ? '#/login' : location.hash))
    if (urlError) setFlash('That link is invalid or has expired. Please request a new one.', 'error')
    else if (!state.session) setFlash('Email confirmed. Please sign in.', 'success')
  }
  state.route = route
  window.addEventListener('hashchange', route)
  route()
}
start()
