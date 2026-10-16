// Alerts that reach the phone / computer even when the app is closed (Web Push).
// Flow: this file registers /sw.js, asks the browser for a push subscription, and saves it in the database.
// When a message or call arrives, a database trigger calls the "push" Edge Function, which sends the alert.
import { CONFIG } from '../config.js'
import { supabase } from './supabase.js'
import { h, toast, friendlyError } from './dom.js'

const SW_URL = './sw.js'
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushConfigured = () => !!CONFIG.vapidPublicKey
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
export const needsInstall = () => isIOS() && !isStandalone()          // iPhones only allow alerts for apps added to the Home Screen

export function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const previewKey = 'lsdk.push.hidePreview'
export const hidePreview = () => { try { return localStorage.getItem(previewKey) === '1' } catch { return false } }
const setHidePreview = (v) => { try { localStorage.setItem(previewKey, v ? '1' : '0') } catch { /* ignore */ } }

async function registration() {
  await navigator.serviceWorker.register(SW_URL)
  return navigator.serviceWorker.ready
}

async function save(sub) {
  const j = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent.slice(0, 200), p_show_preview: !hidePreview(),
  })
  if (error) throw error
}

async function currentSub() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration(SW_URL)
  return reg ? reg.pushManager.getSubscription() : null
}

export async function pushStatus() {
  if (!pushSupported()) return needsInstall() ? 'install' : 'unsupported'
  if (needsInstall()) return 'install'
  if (!pushConfigured()) return 'unconfigured'
  if (Notification.permission === 'denied') return 'blocked'
  return (await currentSub()) && Notification.permission === 'granted' ? 'on' : 'off'
}

// Must be called from a tap (browsers refuse to ask for permission otherwise).
export async function enablePush() {
  if (!pushSupported() || !pushConfigured()) throw new Error('Alerts are not available here.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Alerts were not allowed.')
  const reg = await registration()
  const key = urlBase64ToUint8Array(CONFIG.vapidPublicKey)
  let sub = await reg.pushManager.getSubscription()
  try { sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) }
  catch (e) { if (e.name !== 'InvalidStateError') throw e; await sub?.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) }
  await save(sub)
  return true
}

export async function disablePush() {
  const sub = await currentSub()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  await supabase.rpc('remove_push_subscription', { p_endpoint: endpoint })
}

// Before signing out: this device must stop receiving the previous person's alerts.
export async function unlinkPush() {
  try { const sub = await currentSub(); if (sub) await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }) } catch { /* ignore */ }
}

let started = false
// Called when the chat screen opens: refreshes the saved subscription (also when a different person signs in on this device)
// and lets a tapped alert open the right chat.
export function initPush() {
  if (started || !pushSupported()) return
  started = true
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'lsdk-open' && /^#\//.test(e.data.hash || '')) location.hash = e.data.hash })
  if (pushConfigured() && Notification.permission === 'granted') {
    registration().then(async (reg) => { const sub = await reg.pushManager.getSubscription(); if (sub) await save(sub) }).catch(() => {})
  }
}

// The block shown in Settings > Notifications.
export function pushSettingsEl() {
  const status = h('p', { class: 'small', 'aria-live': 'polite' }, 'Checking...')
  const btn = h('button', { class: 'btn', type: 'button', hidden: true })
  const hide = h('input', { id: 's-pushpreview', type: 'checkbox', role: 'switch' })
  hide.checked = hidePreview()
  const hideRow = h('label', { class: 'switch-row', for: 's-pushpreview' }, h('span', { class: 'switch-text' }, h('strong', {}, 'Hide message text in alerts'), h('small', { class: 'block' }, 'Alerts only say "New message", so nobody can read them over your shoulder or on a locked screen.')), hide, h('span', { class: 'switch', 'aria-hidden': 'true' }))
  let state = 'off'
  const paint = async () => {
    state = await pushStatus()
    const text = {
      on: 'On. You will get an alert for new messages and calls even when this app is closed.',
      off: 'Off. Turn this on to get alerts for messages and calls when the app is closed.',
      blocked: 'Blocked. Alerts are blocked for this site in your browser settings. Allow notifications for it there, then come back.',
      install: 'On iPhone and iPad, alerts only work for the installed app: tap Share, choose "Add to Home Screen", open LSDK Chat from your Home Screen, then turn this on.',
      unsupported: 'This browser cannot show alerts when the app is closed. Try Chrome, Edge, Firefox or Safari (iPhone: add to Home Screen first).',
      unconfigured: 'Alerts are not switched on for this app yet (the owner still has to finish setup).',
    }[state]
    status.textContent = text
    btn.hidden = !['on', 'off'].includes(state)
    btn.textContent = state === 'on' ? 'Turn off alerts' : 'Turn on alerts'
    hideRow.hidden = state !== 'on'
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      if (state === 'on') { await disablePush(); toast('Alerts turned off', 'success') }
      else { await enablePush(); toast('Alerts turned on', 'success') }
    } catch (e) { toast(friendlyError(e), 'error') }
    btn.disabled = false; paint()
  })
  hide.addEventListener('change', async () => {
    setHidePreview(hide.checked)
    try { const sub = await currentSub(); if (sub) await save(sub); toast('Saved', 'success') } catch (e) { toast(friendlyError(e), 'error') }
  })
  paint()
  return h('div', { class: 'field' }, h('h3', {}, 'Alerts when the app is closed'), status, btn, hideRow,
    h('p', { class: 'small' }, 'Alerts are sent through your browser\'s push service (Google, Apple or Mozilla) and are encrypted. Calls show as a notification you tap to answer; they cannot ring like a phone call while the app is closed.'))
}
