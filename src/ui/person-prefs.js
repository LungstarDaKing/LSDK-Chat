// "Just for this person" settings shown in their profile card: chat background + ringtone.
// Stored only on this device. The other person never sees these choices.
import { h, clear, toast, friendlyError } from '../lib/dom.js'
import { editImage } from './image-editor.js'
import { nickOf, setNickname } from '../lib/nicknames.js'
import { BACKGROUNDS, backgroundCss, getPersonBg, setPersonBg, getPersonImage, setPersonImage, removePersonImage, getDim } from '../lib/theme.js'
import { STOCK, MAX_CUSTOM, getPrefs, setPersonTone, listCustom, addCustomTone, previewTone, stopRingtone, toneName } from '../lib/ringtones.js'

export function personalSection(uid, name, { username = name, onNick } = {}) {
  const nickInput = h('input', { type: 'text', maxLength: 30, value: nickOf(uid) || '', placeholder: username, 'aria-label': `Nickname for ${username}`, autocomplete: 'off' })
  const saveNick = async (clear = false) => {
    try { const n = await setNickname(uid, clear ? '' : nickInput.value); toast(n ? `Nickname set: ${n}` : 'Nickname removed', 'success'); onNick?.() }
    catch (e) { toast(/does not exist|schema cache/i.test(e.message || '') ? 'Nicknames need the v0.9 database update.' : friendlyError(e), 'error') }
  }
  nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNick() } })
  /* ----- background ----- */
  const grid = h('div', { class: 'bg-grid', role: 'radiogroup', 'aria-label': `Chat background for ${name}` })
  const msg = h('div', { class: 'msg', role: 'alert' })
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': `Choose a background picture for ${name}`,
    onchange: async () => {
      const f = file.files[0]; file.value = ''; if (!f) return
      try { const edited = await editImage(f, { title: `Background for ${name}` }); if (!edited) return; await setPersonImage(uid, edited); drawBg(); msg.textContent = '' } catch (e) { msg.textContent = e.message; msg.className = 'msg error' }
    } })
  const swatch = (id, label, css) => {
    const on = (getPersonBg(uid) || 'default') === id
    const sw = h('button', { type: 'button', role: 'radio', class: `bg-sw${on ? ' on' : ''}`, 'aria-checked': String(on), 'aria-label': label, title: label,
      onclick: () => { setPersonBg(uid, id === 'default' ? null : id); drawBg() } }, h('span', {}, label))
    if (css) sw.style.background = css
    return sw
  }
  const drawBg = () => {
    clear(grid)
    grid.append(swatch('default', 'Same as all chats', backgroundCss()))
    for (const b of BACKGROUNDS) grid.append(swatch(b.id, b.name, backgroundCss(b.id)))
    if (getPersonImage(uid)) grid.append(swatch('custom', 'My picture', backgroundCss('custom', getDim(), getPersonImage(uid))))
  }
  drawBg()

  /* ----- ringtone ----- */
  const sel = h('select', { 'aria-label': `Ringtone for ${name}` })
  const drawTones = () => {
    clear(sel)
    const cur = getPrefs().per[uid] || ''
    sel.append(h('option', { value: '' }, `Same as everyone (${toneName(getPrefs().def)})`))
    for (const t of [...STOCK, ...listCustom()]) sel.append(h('option', { value: t.id, selected: cur === t.id }, t.name))
  }
  drawTones()
  sel.addEventListener('change', () => { stopRingtone(); setPersonTone(uid, sel.value || null); if (sel.value) previewTone(sel.value); toast('Saved', 'success') })
  const toneFile = h('input', { type: 'file', accept: 'audio/*', hidden: true, 'aria-label': `Choose an audio file as the ringtone for ${name}`,
    onchange: async () => {
      const f = toneFile.files[0]; toneFile.value = ''; if (!f) return
      try {
        const t = await addCustomTone(f)
        const id = t?.id || listCustom().at(-1)?.id
        if (id) setPersonTone(uid, id)
        drawTones(); toast('Ringtone added for ' + name, 'success')
      } catch (e) { toast(e.message || 'Could not add that audio file.', 'error') }
    } })

  return h('div', { class: 'person-prefs' },
    h('h4', {}, `Just for ${username}`),
    h('p', { class: 'small' }, 'Background and ringtone choices are only yours and stay on this device. A nickname is shared with them.'),
    h('div', { class: 'field' }, h('label', {}, 'Nickname'), nickInput,
      h('small', {}, `Only you and ${username} can see it. Their username stays the same.`),
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', type: 'button', onclick: () => saveNick() }, 'Save nickname'),
        nickOf(uid) && h('button', { class: 'btn small', type: 'button', onclick: () => saveNick(true) }, 'Remove'))),
    h('div', { class: 'field' }, h('label', {}, 'Chat background'), grid,
      h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, 'Use my own picture'), ' ',
      getPersonImage(uid) && h('button', { class: 'btn small', type: 'button', onclick: () => { removePersonImage(uid); drawBg() } }, 'Remove my picture'), file, msg),
    h('div', { class: 'field' }, h('label', {}, 'Ringtone when they call'), sel,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => previewTone(sel.value || getPrefs().def) }, '▶ Play'),
        h('button', { class: 'btn small', type: 'button', onclick: () => toneFile.click() }, `Use my own song (${listCustom().length}/${MAX_CUSTOM} saved)`), toneFile,
        h('button', { class: 'btn small', type: 'button', onclick: () => stopRingtone() }, '■ Stop'))))
}
