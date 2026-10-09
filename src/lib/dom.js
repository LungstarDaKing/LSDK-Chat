// Tiny DOM helper. Strings are ALWAYS inserted as text (never parsed as HTML),
// which is what keeps user-generated content (usernames, messages) XSS-safe.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  append(el, children)
  return el
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el }

export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts')
  if (!box) {
    box = h('div', { id: 'toasts', 'aria-live': 'polite', role: 'status' })
    document.body.append(box)
  }
  const t = h('div', { class: `toast ${kind}` }, message)
  box.append(t)
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500)
}

// Native <dialog>: focus trapping + Esc handling come from the browser.
export function dialog({ title, body, actions = [], onClose, wide = false }) {
  const dlg = h('dialog', { class: `dlg${wide ? ' wide' : ''}`, 'aria-label': title })
  const close = () => { dlg.close() }
  const bar = h('div', { class: 'dlg-actions' },
    actions.map((a) => h('button', {
      type: 'button',
      class: `btn ${a.kind || ''}`,
      onclick: async (e) => {
        const btn = e.currentTarget
        btn.disabled = true
        try { const keep = await a.onClick?.(close); if (keep !== 'keep-open' && a.close !== false) close() }
        finally { btn.disabled = false }
      },
    }, a.label)))
  dlg.append(h('h2', {}, title), h('div', { class: 'dlg-body' }, body), bar)
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.() })
  document.body.append(dlg)
  dlg.showModal()
  return { el: dlg, close }
}

export const confirmDialog = (title, text, okLabel = 'OK', danger = false) =>
  new Promise((resolve) => {
    let answered = false
    dialog({
      title, body: h('p', {}, text),
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false) } },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true) } },
      ],
      onClose: () => { if (!answered) resolve(false) },
    })
  })

export function debounce(fn, ms) {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

// Turn Supabase / Postgres errors into short, human messages.
export function friendlyError(err) {
  const m = (err && (err.message || err.error_description)) || String(err || '')
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Network problem - check your connection and try again.'
  if (/duplicate key|23505|already taken/i.test(m)) return 'That value is already taken.'
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that."
  if (/rate limit|too many/i.test(m) && !/messages too quickly/i.test(m)) return 'Too many attempts. Please wait a few minutes and try again.'
  return m || 'Something went wrong.'
}
