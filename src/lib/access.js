// "Access granted" moment shown right after a successful sign-in.
// auth.js calls armAccess() just before it signs in; main.js plays the animation when Supabase confirms
// SIGNED_IN. It is armed explicitly so it never fires on silent token refreshes or when a tab regains focus.
let armed = false
export const armAccess = () => { armed = true }
export const disarmAccess = () => { armed = false }
export const consumeAccess = () => { const a = armed; armed = false; return a }

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function playAccessGranted(appName = 'LSDKChat') {
  if (document.querySelector('.access')) return
  const el = document.createElement('div')
  el.className = 'access'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-label', 'Access granted')
  // Static markup only (nothing from the user), so innerHTML is safe here.
  el.innerHTML = `
    <div class="access-rays"></div>
    <div class="access-scan"></div>
    <div class="access-core">
      <span class="shock"></span><span class="shock s2"></span><span class="shock s3"></span>
      <div class="sparks"></div>
      <svg class="seal" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="seal-fill" cx="60" cy="60" r="52"/>
        <circle class="seal-track" cx="60" cy="60" r="52"/>
        <circle class="seal-ring" cx="60" cy="60" r="52" pathLength="1"/>
        <path class="seal-check" d="M38 62 L54 78 L84 44" pathLength="1"/>
      </svg>
    </div>
    <h2 class="access-title" aria-hidden="true"></h2>
    <p class="access-sub" aria-hidden="true"></p>`

  const title = el.querySelector('.access-title')
  ;[...'Access granted'].forEach((ch, i) => {
    const s = document.createElement('span')
    s.textContent = ch === ' ' ? '\u00a0' : ch
    s.style.setProperty('--i', i)
    title.append(s)
  })
  el.querySelector('.access-sub').textContent = `Welcome back to ${appName}`
  const sparks = el.querySelector('.sparks')
  for (let i = 0; i < 24; i++) {
    const s = document.createElement('i')
    s.style.setProperty('--a', `${(360 / 24) * i + (Math.random() * 10 - 5)}deg`)
    s.style.setProperty('--d', `${90 + Math.random() * 110}px`)
    s.style.setProperty('--s', `${4 + Math.random() * 6}px`)
    s.style.setProperty('--c', ['#f5b83d', '#ffe29a', '#a996ff', '#2dd4bf', '#ffffff'][i % 5])
    sparks.append(s)
  }

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
  setTimeout(leave, calm() ? 900 : 2100)
}
