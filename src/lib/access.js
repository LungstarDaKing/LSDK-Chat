// "Access granted" moment shown right after a successful sign-in.
// auth.js calls armAccess() just before it signs in; main.js plays the animation when Supabase confirms
// SIGNED_IN. It is armed explicitly so it never fires on silent token refreshes or when a tab regains focus.
let armed = false
export const armAccess = () => { armed = true }
export const disarmAccess = () => { armed = false }
export const consumeAccess = () => { const a = armed; armed = false; return a }

import { motionOn } from './motion.js'

export function playAccessGranted(appName = 'LSDKChat') {
  if (document.querySelector('.access')) return
  const el = document.createElement('div')
  el.className = 'access'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-label', 'Access granted')
  // Static markup only (nothing from the user), so innerHTML is safe here.
  el.innerHTML = `
    <div class="ax-grid"></div>
    <div class="ax-beam"></div>
    <i class="ax-corner tl"></i><i class="ax-corner tr"></i><i class="ax-corner bl"></i><i class="ax-corner br"></i>
    <div class="ax-tag top"><span>SECURE SIGN-IN</span><span class="ax-id"></span></div>
    <div class="ax-core">
      <svg class="ax-svg" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="r-outer" cx="100" cy="100" r="92"/>
        <circle class="r-ticks" cx="100" cy="100" r="82"/>
        <g class="r-arcs"><path d="M100 28 A72 72 0 0 1 172 100"/><path d="M100 172 A72 72 0 0 1 28 100"/><path d="M52 52 A72 72 0 0 1 80 31" /></g>
        <circle class="r-track" cx="100" cy="100" r="58"/>
        <circle class="r-draw" cx="100" cy="100" r="58" pathLength="1"/>
        <circle class="r-glow" cx="100" cy="100" r="44"/>
        <path class="r-check" d="M76 102 L94 120 L128 80" pathLength="1"/>
      </svg>
      <span class="ax-pulse"></span><span class="ax-pulse p2"></span>
    </div>
    <h2 class="ax-title" aria-hidden="true"><span class="ax-word"></span><span class="ax-word"></span></h2>
    <p class="ax-sub" aria-hidden="true"></p>
    <ul class="ax-log" aria-hidden="true"><li>Session verified</li><li>Profile loaded</li><li>Link established</li></ul>
    <div class="ax-bar" aria-hidden="true"><i></i></div>
    <div class="ax-tag bottom"><span>TAP TO CONTINUE</span><span class="ax-pct">100%</span></div>`

  const words = el.querySelectorAll('.ax-word')
  ;['ACCESS', 'GRANTED'].forEach((w, k) => {
    ;[...w].forEach((ch, i) => { const s = document.createElement('span'); s.textContent = ch; s.style.setProperty('--i', i + k * 6); words[k].append(s) })
    words[k].dataset.t = w
  })
  el.querySelector('.ax-sub').textContent = `Identity confirmed. Welcome back to ${appName}.`
  const code = new Uint8Array(3); try { crypto.getRandomValues(code) } catch { /* fine */ }
  el.querySelector('.ax-id').textContent = 'ID ' + [...code].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()

  document.body.append(el)
  let gone = false
  const finish = () => { if (!gone) { gone = true; el.remove() } }
  const leave = () => {
    if (gone || el.classList.contains('leave')) return
    el.classList.add('leave')
    el.addEventListener('animationend', (e) => { if (e.target === el) finish() })
    setTimeout(finish, 1200)                              // safety net
  }
  el.addEventListener('pointerdown', leave)               // tap to skip
  setTimeout(leave, motionOn() ? 2900 : 1000)
}
