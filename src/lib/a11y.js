// Accessibility preferences. Stored only in this browser (localStorage); nothing is uploaded.
const K = 'lsdkchat.a11y'
export const TEXT_SIZES = [[90, 'Small'], [100, 'Normal'], [115, 'Large'], [130, 'Larger'], [150, 'Largest']]
export const DICTATION_LANGS = [
  ['en-ZA', 'English (South Africa)'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['af-ZA', 'Afrikaans'],
  ['zu-ZA', 'isiZulu'], ['xh-ZA', 'isiXhosa'], ['st-ZA', 'Sesotho'], ['tn-ZA', 'Setswana'], ['ts-ZA', 'Xitsonga'], ['ss-latn-za', 'siSwati'], ['ve-ZA', 'Tshivenda'], ['nso-ZA', 'Sepedi'],
]
const DEFAULTS = { size: 100, contrast: 'normal', motion: 'system', announce: true, lang: 'en-ZA', commands: true }

const read = () => { try { const o = JSON.parse(localStorage.getItem(K) || '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} } }
export function getA11y() {
  const o = read(), d = DEFAULTS
  return {
    size: TEXT_SIZES.some(([v]) => v === o.size) ? o.size : d.size,
    contrast: o.contrast === 'high' ? 'high' : 'normal',
    motion: o.motion === 'reduce' ? 'reduce' : 'system',
    announce: o.announce !== false,
    lang: DICTATION_LANGS.some(([v]) => v === o.lang) ? o.lang : d.lang,
    commands: o.commands !== false,
  }
}
export function setA11y(key, value) {
  const o = { ...getA11y(), [key]: value }
  try { localStorage.setItem(K, JSON.stringify(o)) } catch { /* private mode: lasts until the page closes */ }
  apply()
}
export function apply() {
  const a = getA11y(), root = document.documentElement
  root.style.fontSize = `${a.size}%`
  if (a.contrast === 'high') root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast')
  if (a.motion === 'reduce') root.setAttribute('data-motion', 'reduce'); else root.removeAttribute('data-motion')
  const log = document.querySelector('.messages')
  if (log) log.setAttribute('aria-live', a.announce ? 'polite' : 'off')
}
apply()
