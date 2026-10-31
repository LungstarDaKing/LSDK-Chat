// Decorative motion (sign-in hero, "Access granted"). Three choices, saved on this device:
//   Auto  = follow the device's "reduce motion" setting      On = always animate      Still = never animate
// The animations live in motion-anim.css, which is only attached while motion is on, so "Still" really is still.
import { getA11y } from './a11y.js'
import animUrl from '../motion-anim.css?url'

const osReduces = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
export const motionMode = () => getA11y().motion                       // 'system' | 'on' | 'reduce'
export const motionOn = () => { const m = motionMode(); return m === 'on' ? true : m === 'reduce' ? false : !osReduces() }

let link = null
const listeners = new Set()
export const onMotion = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

/** Attach or remove the animation stylesheet to match the current choice, and tell listeners (the background canvas). */
export function applyMotion() {
  const on = motionOn()
  if (on && !link) { link = document.createElement('link'); link.rel = 'stylesheet'; link.href = animUrl; link.dataset.motion = 'anim'; document.head.append(link) }
  if (!on && link) { link.remove(); link = null }
  document.documentElement.dataset.anim = on ? 'on' : 'still'
  listeners.forEach((f) => { try { f(on) } catch { /* ignore */ } })
}
try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyMotion) } catch { /* old browser */ }
