// A call window you can shrink to a small floating card, drag anywhere, and keep using the app behind.
// Used by the one-to-one call screen and the group call screen.
let lastPos = null     // where the person left the card, remembered for the next call in this visit

export function attachMini(el) {
  let drag = null
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const place = (left, top) => {
    const r = el.getBoundingClientRect()
    left = clamp(left, 4, window.innerWidth - r.width - 4); top = clamp(top, 4, window.innerHeight - r.height - 4)
    el.style.left = `${left}px`; el.style.top = `${top}px`; el.style.right = 'auto'; el.style.bottom = 'auto'
    lastPos = { left, top }
  }
  el.addEventListener('pointerdown', (e) => {
    if (!el.classList.contains('mini') || e.target.closest('button')) return
    const r = el.getBoundingClientRect()
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    el.setPointerCapture?.(e.pointerId); el.classList.add('dragging')
  })
  el.addEventListener('pointermove', (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy) })
  const end = () => { drag = null; el.classList.remove('dragging') }
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
  const keep = () => { if (el.classList.contains('mini') && lastPos) place(lastPos.left, lastPos.top) }
  window.addEventListener('resize', keep)
  return {
    // turn the small card on or off
    set(on) {
      el.classList.toggle('mini', on)
      el.setAttribute('aria-modal', on ? 'false' : 'true')
      if (on) { if (lastPos) requestAnimationFrame(() => place(lastPos.left, lastPos.top)) }
      else for (const k of ['left', 'top', 'right', 'bottom']) el.style[k] = ''
    },
    destroy() { window.removeEventListener('resize', keep) },
  }
}

// Floats a video above other windows and apps (phones and computers that support it).
export async function floatVideo(video) {
  if (!document.pictureInPictureEnabled || !video?.requestPictureInPicture) throw new Error('This browser cannot float the video over other apps.')
  if (document.pictureInPictureElement === video) { await document.exitPictureInPicture(); return }
  if (!video.srcObject || !video.srcObject.getVideoTracks().some((t) => t.readyState === 'live')) throw new Error('There is no video to float yet. Switch to video or wait for the other person\'s camera or screen.')
  await video.requestPictureInPicture()
}
