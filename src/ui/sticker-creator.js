import { h, dialog } from '../lib/dom.js'

// "Create": turn any picture into a 512 x 512 sticker (transparent WebP).
export const SIZE = 512
export function fitRect(w, h2, size, mode) {
  const s = mode === 'fill' ? Math.max(size / w, size / h2) : Math.min(size / w, size / h2)
  const dw = w * s, dh = h2 * s
  return { dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh }
}
export function draw(canvas, bmp, { mode = 'fit', round = false, size = SIZE } = {}) {
  canvas.width = canvas.height = size
  const c = canvas.getContext('2d')
  c.clearRect(0, 0, size, size)
  c.save()
  if (round) { const r = size * 0.14; c.beginPath(); c.roundRect(0, 0, size, size, r); c.clip() }
  const { dx, dy, dw, dh } = fitRect(bmp.width, bmp.height, size, mode)
  c.drawImage(bmp, dx, dy, dw, dh)
  c.restore()
}
export async function makeStickerBlob(bmp, opts) {
  const canvas = document.createElement('canvas')
  draw(canvas, bmp, { ...opts, size: SIZE })
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.9))
  if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot make stickers. Try Chrome, Edge or Firefox.')
  return blob
}

export function openStickerCreator({ onDone }) {
  let bmp = null, mode = 'fit', round = false
  const canvas = h('canvas', { class: 'stk-canvas', width: 256, height: 256, role: 'img', 'aria-label': 'Sticker preview' })
  const err = h('div', { class: 'msg error', role: 'alert' })
  const redraw = () => { if (bmp) draw(canvas, bmp, { mode, round, size: 256 }) }
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': 'Choose a picture',
    onchange: async () => {
      const f = file.files[0]; if (!f) return
      err.textContent = ''
      if (f.size > 10 * 1024 * 1024) { err.textContent = 'Please choose a picture under 10 MB.'; return }
      try { bmp = await createImageBitmap(f) } catch { err.textContent = 'That picture could not be read. Try another one.'; return }
      redraw()
    } })
  const fitRadio = (value, label, checked) => h('label', { class: 'row tight' }, h('input', { type: 'radio', name: 'stk-mode', value, checked, onchange: () => { mode = value; redraw() } }), label)
  const body = h('div', { class: 'stk-creator' },
    h('p', { class: 'small' }, 'Pick a picture to turn into a sticker. Photos of other people: only use ones you are allowed to share.'),
    file, h('div', { class: 'stk-preview' }, canvas),
    h('div', { class: 'row' }, fitRadio('fit', 'Fit whole picture', true), fitRadio('fill', 'Fill the square', false)),
    h('label', { class: 'row tight' }, h('input', { type: 'checkbox', onchange: (e) => { round = e.target.checked; redraw() } }), 'Rounded corners'),
    err)
  const finish = (send) => async () => {
    if (!bmp) { err.textContent = 'Choose a picture first.'; return 'keep-open' }
    try { await onDone(await makeStickerBlob(bmp, { mode, round }), send) } catch (e) { err.textContent = e.message || 'Could not make the sticker.'; return 'keep-open' }
  }
  return dialog({ title: 'Create a sticker', body, actions: [{ label: 'Cancel' }, { label: 'Save', onClick: finish(false) }, { label: 'Save & send', kind: 'primary', onClick: finish(true) }] })
}
