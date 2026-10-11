// "Pick a time" dialog used by reminders and scheduled messages.
import { h, dialog, toast, friendlyError } from '../lib/dom.js'
import { quickTimes, toLocalInput } from '../lib/tools.js'

// onPick(Date) may throw; the error is shown and the dialog stays open.
// extra: optional extra DOM (e.g. a "when they come online" checkbox) placed under the picker.
export function whenDialog({ title, intro, confirmLabel, onPick, extra, allowNone = false, onNone }) {
  const custom = h('input', { type: 'datetime-local', id: 'when-custom', min: toLocalInput(new Date(Date.now() + 60000)) })
  custom.value = toLocalInput(new Date(Date.now() + 36e5))
  const err = h('div', { class: 'msg error', role: 'alert' })
  let chosen = quickTimes()[0].date
  const picks = h('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'Quick times' })
  const draw = (sel) => {
    picks.replaceChildren(...quickTimes().map((q, i) => h('button', { type: 'button', role: 'radio', class: sel === i ? 'on' : '', 'aria-checked': String(sel === i),
      onclick: () => { chosen = q.date; custom.value = toLocalInput(q.date); draw(i) } }, q.label)))
  }
  draw(0)
  custom.addEventListener('input', () => { chosen = custom.value ? new Date(custom.value) : null; draw(-1) })
  let dlg
  const actions = [{ label: 'Cancel' }]
  if (allowNone) actions.push({ label: allowNone, onClick: async () => { try { await onNone() } catch (e) { err.textContent = friendlyError(e); return 'keep-open' } } })
  actions.push({ label: confirmLabel, kind: 'primary', onClick: async () => {
    err.textContent = ''
    if (!chosen || isNaN(chosen)) { err.textContent = 'Pick a date and time.'; return 'keep-open' }
    if (chosen.getTime() < Date.now() + 5000) { err.textContent = 'Pick a time in the future.'; return 'keep-open' }
    try { await onPick(chosen) } catch (e) { err.textContent = friendlyError(e); return 'keep-open' }
  } })
  dlg = dialog({ title, body: [intro && h('p', { class: 'small' }, intro), picks,
    h('div', { class: 'field' }, h('label', { for: 'when-custom' }, 'Or choose a date and time'), custom), extra, err], actions })
  return dlg
}

// Save-to-collection dialog.
export function saveDialog({ collections = [], onSave }) {
  const name = h('input', { type: 'text', maxLength: 30, value: collections[0] || 'Saved', list: 'coll-list', 'aria-label': 'Collection name', autocomplete: 'off' })
  const list = h('datalist', { id: 'coll-list' }, collections.map((c) => h('option', { value: c })))
  const err = h('div', { class: 'msg error', role: 'alert' })
  return dialog({ title: 'Save message', body: [h('p', { class: 'small' }, 'Pick a collection or type a new name. Only you can see your saved messages. A saved message disappears if the original is deleted.'),
    h('div', { class: 'field' }, h('label', {}, 'Collection'), name, list), err],
  actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
    try { await onSave(name.value.trim() || 'Saved'); toast('Saved', 'success') } catch (e) { err.textContent = friendlyError(e); return 'keep-open' }
  } }] })
}
