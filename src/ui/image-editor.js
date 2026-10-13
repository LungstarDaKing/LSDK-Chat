// Crop + filter editor for pictures (chat wallpapers, status photos, profile pictures).
// Everything happens on this device with <canvas>: the original file is never uploaded by the editor.
// Filters are plain per-pixel maths (not CSS/ctx.filter) so they work in every browser.
import { h, dialog, toast } from '../lib/dom.js'
import { icon } from './icons.js'

export const FILTERS = [
  { id: 'none',  name: 'Original', p: {} },
  { id: 'vivid', name: 'Vivid',    p: { sat: .38, ct: .1 } },
  { id: 'warm',  name: 'Warm',     p: { warm: .22, sat: .1 } },
  { id: 'cool',  name: 'Cool',     p: { warm: -.22, sat: .05 } },
  { id: 'fade',  name: 'Fade',     p: { fade: .22, sat: -.15, ct: -.08 } },
  { id: 'mono',  name: 'Mono',     p: { gray: 1, ct: .12 } },
  { id: 'noir',  name: 'Noir',     p: { gray: 1, ct: .4, br: -.06, vig: .4 } },
  { id: 'sepia', name: 'Sepia',    p: { sepia: 1 } },
  { id: 'dusk',  name: 'Dusk',     p: { warm: -.1, sat: .2, br: -.1, vig: .3 } },
]

const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v)

// Applies a filter to ImageData in place. p: { br, ct, sat, warm, fade, gray, sepia, vig } (all optional, -1..1 / 0..1)
export function applyFilter(img, p = {}) {
  const { br = 0, ct = 0, sat = 0, warm = 0, fade = 0, gray = 0, sepia = 0, vig = 0 } = p
  if (!(br || ct || sat || warm || fade || gray || sepia || vig)) return img
  const d = img.data, W = img.width, H = img.height
  const cf = 1 + ct, sf = 1 + sat
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    let r = d[i], g = d[i + 1], b = d[i + 2]
    if (br) { const k = br * 90; r += k; g += k; b += k }
    if (ct) { r = (r - 128) * cf + 128; g = (g - 128) * cf + 128; b = (b - 128) * cf + 128 }
    if (sat || gray) {
      const l = .299 * r + .587 * g + .114 * b
      const s = gray ? 1 - gray : sf
      r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s
    }
    if (sepia) {
      const nr = .393 * r + .769 * g + .189 * b, ng = .349 * r + .686 * g + .168 * b, nb = .272 * r + .534 * g + .131 * b
      r += (nr - r) * sepia; g += (ng - g) * sepia; b += (nb - b) * sepia
    }
    if (warm) { r += warm * 34; b -= warm * 34; g += warm * 6 }
    if (fade) { const f = fade * .55; r = r * (1 - f) + 205 * f; g = g * (1 - f) + 205 * f; b = b * (1 - f) + 215 * f }
    if (vig) {
      const x = ((px % W) / W - .5) * 2, y = (Math.floor(px / W) / H - .5) * 2
      const m = 1 - vig * Math.min(1, (x * x + y * y) / 2) * 1.1
      r *= m; g *= m; b *= m
    }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b)
  }
  return img
}

const sumParams = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v; return o }

// Draws the cropped picture into `canvas` (already sized) and then applies the filter.
export function renderCrop(canvas, bmp, st, frameW, params) {
  const W = canvas.width, H = canvas.height, k = W / frameW
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const odd = st.rot % 2 === 1
  const rw = odd ? bmp.height : bmp.width, rh = odd ? bmp.width : bmp.height
  const cover = Math.max(W / rw, H / rh), s = cover * st.zoom
  const dw = rw * s, dh = rh * s
  const ox = clamp(st.ox * k, -(dw - W) / 2, (dw - W) / 2), oy = clamp(st.oy * k, -(dh - H) / 2, (dh - H) / 2)
  ctx.save()
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
  ctx.translate(W / 2 + ox, H / 2 + oy); ctx.rotate(st.rot * Math.PI / 2); ctx.scale(s, s)
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
  ctx.restore()
  const hasFilter = Object.values(params).some(Boolean)
  if (hasFilter) { const data = ctx.getImageData(0, 0, W, H); applyFilter(data, params); ctx.putImageData(data, 0, 0) }
}

const ASPECTS = {
  wallpaper: { id: 'wallpaper', label: 'Wallpaper', r: 9 / 16 },
  status:    { id: 'status', label: 'Status', r: 9 / 16 },
  square:    { id: 'square', label: 'Square', r: 1 },
  portrait:  { id: 'portrait', label: '4:5', r: 4 / 5 },
  wide:      { id: 'wide', label: 'Wide', r: 16 / 9 },
}

// Resolves with the edited File (JPEG), or null if the person cancelled.
export async function editImage(file, { title = 'Edit picture', aspect = 'wallpaper', aspects = ['wallpaper', 'portrait', 'square', 'wide'], outMax = 1600, confirm = 'Use picture' } = {}) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Choose a JPG, PNG or WebP picture.', 'error'); return null }
  let bmp
  try { bmp = await createImageBitmap(file) } catch { toast('That picture could not be read.', 'error'); return null }
  return new Promise((resolve) => {
    const st = { zoom: 1, ox: 0, oy: 0, rot: 0, ratio: (ASPECTS[aspect] || ASPECTS.wallpaper).r, aspect, filter: 'none', br: 0, ct: 0, sat: 0 }
    const canvas = h('canvas', { class: 'ed-canvas', 'aria-label': 'Picture preview. Drag to move, scroll or pinch to zoom.', role: 'img' })
    let frameW = 300, frameH = 400
    const params = () => sumParams(FILTERS.find((f) => f.id === st.filter).p, { br: st.br / 100, ct: st.ct / 100, sat: st.sat / 100 })
    const draw = () => { renderCrop(canvas, bmp, st, frameW, params()) }
    const layout = () => {
      const box = { w: 320, h: 400 }
      if (st.ratio >= box.w / box.h) { frameW = box.w; frameH = Math.round(box.w / st.ratio) } else { frameH = box.h; frameW = Math.round(box.h * st.ratio) }
      canvas.width = frameW; canvas.height = frameH
      canvas.style.width = frameW + 'px'; canvas.style.height = frameH + 'px'
      draw()
    }

    // pan + pinch zoom
    const ptrs = new Map(); let pinch = 0
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = 0 })
    canvas.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return
      if (ptrs.size === 1) { st.ox += e.clientX - p.x; st.oy += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; clampOffset(); draw() }
      else if (ptrs.size === 2) {
        p.x = e.clientX; p.y = e.clientY
        const [a, b] = [...ptrs.values()], dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) { setZoom(st.zoom * dist / pinch) }
        pinch = dist
      }
    })
    const up = (e) => { ptrs.delete(e.pointerId); pinch = 0 }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(st.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)) }, { passive: false })
    canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 30 : 10
      if (e.key === 'ArrowLeft') st.ox -= step; else if (e.key === 'ArrowRight') st.ox += step
      else if (e.key === 'ArrowUp') st.oy -= step; else if (e.key === 'ArrowDown') st.oy += step
      else if (e.key === '+' || e.key === '=') setZoom(st.zoom * 1.1); else if (e.key === '-') setZoom(st.zoom / 1.1); else return
      e.preventDefault(); clampOffset(); draw()
    })
    canvas.tabIndex = 0
    function clampOffset() {                                   // keep the frame fully covered
      const odd = st.rot % 2 === 1, rw = odd ? bmp.height : bmp.width, rh = odd ? bmp.width : bmp.height
      const s = Math.max(frameW / rw, frameH / rh) * st.zoom
      const mx = Math.max(0, (rw * s - frameW) / 2), my = Math.max(0, (rh * s - frameH) / 2)
      st.ox = clamp(st.ox, -mx, mx); st.oy = clamp(st.oy, -my, my)
    }
    function setZoom(z) { st.zoom = clamp(z, 1, 5); zoomInput.value = String(st.zoom); clampOffset(); draw() }

    const zoomInput = h('input', { type: 'range', min: 1, max: 5, step: 0.01, value: 1, 'aria-label': 'Zoom', oninput: () => setZoom(Number(zoomInput.value)) })
    const slider = (label, key) => {
      const el = h('input', { type: 'range', min: -100, max: 100, step: 1, value: 0, 'aria-label': label, oninput: () => { st[key] = Number(el.value); draw() } })
      return h('label', { class: 'ed-slider' }, h('span', {}, label), el)
    }

    // aspect chips
    const aspBtns = {}
    const setAspect = (id) => {
      st.aspect = id; st.ratio = id === 'original' ? bmp.width / bmp.height : ASPECTS[id].r
      for (const [k, b] of Object.entries(aspBtns)) b.setAttribute('aria-pressed', String(k === id))
      st.ox = st.oy = 0; layout()
    }
    const aspRow = h('div', { class: 'filters ed-aspects', role: 'group', 'aria-label': 'Shape' },
      [...aspects.map((a) => [a, ASPECTS[a].label]), ['original', 'Original']].map(([id, label]) =>
        (aspBtns[id] = h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(id === st.aspect), onclick: () => setAspect(id) }, label))))

    // filter thumbnails (centre crop of the source, drawn once)
    const thumbs = h('div', { class: 'ed-filters', role: 'radiogroup', 'aria-label': 'Filters' })
    const fBtns = {}
    for (const f of FILTERS) {
      const c = h('canvas', { width: 64, height: 64 })
      renderCrop(c, bmp, { zoom: 1, ox: 0, oy: 0, rot: 0 }, 64, f.p)
      fBtns[f.id] = h('button', { class: 'ed-f', type: 'button', role: 'radio', 'aria-checked': String(f.id === 'none'), onclick: () => {
        st.filter = f.id; for (const [k, b] of Object.entries(fBtns)) b.setAttribute('aria-checked', String(k === f.id)); draw()
      } }, c, h('span', {}, f.name))
      thumbs.append(fBtns[f.id])
    }

    const rotate = h('button', { class: 'btn small', type: 'button', onclick: () => { st.rot = (st.rot + 1) % 4; st.ox = st.oy = 0; draw() } }, icon('reply', 16), ' Rotate')
    const reset = h('button', { class: 'btn small', type: 'button', onclick: () => {
      Object.assign(st, { zoom: 1, ox: 0, oy: 0, rot: 0, filter: 'none', br: 0, ct: 0, sat: 0 }); zoomInput.value = '1'
      body.querySelectorAll('.ed-slider input').forEach((i) => { i.value = '0' })
      for (const [k, b] of Object.entries(fBtns)) b.setAttribute('aria-checked', String(k === 'none')); draw()
    } }, 'Reset')

    let done = false
    const body = h('div', { class: 'editor' },
      h('div', { class: 'ed-stage' }, canvas),
      h('div', { class: 'ed-zoom' }, icon('search', 16), zoomInput, rotate),
      aspRow, thumbs,
      h('div', { class: 'ed-sliders' }, slider('Brightness', 'br'), slider('Contrast', 'ct'), slider('Colour', 'sat')),
      h('div', { class: 'row' }, reset, h('span', { class: 'small' }, 'Edited on this device. Drag the picture to move it.')))
    const d = dialog({
      title, wide: true, body,
      actions: [{ label: 'Cancel' }, { label: confirm, kind: 'primary', close: false, onClick: async () => {
        const long = Math.min(outMax, Math.max(bmp.width, bmp.height))
        const r = st.ratio
        const W = r >= 1 ? long : Math.round(long * r), H = r >= 1 ? Math.round(long / r) : long
        const out = h('canvas', { width: W, height: H })
        renderCrop(out, bmp, st, frameW, params())
        const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', .88))
        if (!blob) { toast('That picture could not be saved.', 'error'); return 'keep-open' }
        done = true; bmp.close?.()
        resolve(new File([blob], (file.name || 'picture').replace(/\.[^.]+$/, '') + '-edited.jpg', { type: 'image/jpeg' }))
        d.close()
      } }],
      onClose: () => { if (!done) { bmp.close?.(); resolve(null) } },
    })
    setAspect(st.aspect in ASPECTS || st.aspect === 'original' ? st.aspect : 'wallpaper')
  })
}
