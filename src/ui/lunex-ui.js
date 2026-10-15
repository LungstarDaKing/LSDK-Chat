import { h, clear, toast, confirmDialog } from '../lib/dom.js'
import { icon } from './icons.js'
import { toHistory } from '../lib/lunex.js'
import { supabase } from '../lib/supabase.js'

// The LUNEX chat window: a full-screen conversation (a centred card on big screens).
// The conversation lives only in this browser (localStorage) and is removed when you sign out.
const KEY = (id) => `lsdk.lunex.${id}`
const MAX_STORED = 100
const CHIPS = [
  ['How do I make a group call?'],
  ['Research: ', 'Research a topic', true],
  ['/translate zulu: good morning', 'Translate'],
  ['/calc 15% of 240', 'Quick maths'],
  ['/help', 'What can you do?'],
]
let wired = false
const wipeAll = () => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('lsdk.lunex.')) localStorage.removeItem(k) } catch { /* ignore */ } }
const validTurn = (t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string'
const safeHref = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null } catch { return null } }

export class LunexPanel {
  constructor(ctx, client) {
    this.ctx = ctx; this.client = client; this.el = null; this.busy = false; this.woke = false; this.remaining = null
    this.turns = this.load()
    if (!wired) { wired = true; try { supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') wipeAll() }) } catch { /* ignore */ } }
  }

  load() { try { const a = JSON.parse(localStorage.getItem(KEY(this.ctx.me.id)) || '[]'); return Array.isArray(a) ? a.filter(validTurn).slice(-MAX_STORED) : [] } catch { return [] } }
  save() { try { localStorage.setItem(KEY(this.ctx.me.id), JSON.stringify(this.turns.slice(-MAX_STORED))) } catch { /* storage full or blocked */ } }
  preview() { const t = this.turns.at(-1); return t ? `${t.role === 'user' ? 'You: ' : ''}${t.text.replace(/\s+/g, ' ').slice(0, 80)}` : 'Ask me anything - answers, research, summaries' }

  /* ---------- open / close ---------- */
  open() {
    if (this.el) { this.input.focus(); return }
    if (!this.woke) { this.woke = true; this.client.wake() }
    this.prev = document.activeElement
    this.log = h('div', { class: 'lx-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with LUNEX' })
    this.sub = h('div', { class: 'lx-sub' }, this.remaining != null ? `${this.remaining} messages left today` : 'AI assistant')
    this.input = h('textarea', { class: 'lx-input', rows: 1, maxlength: 2000, placeholder: 'Message LUNEX…', 'aria-label': 'Message LUNEX', enterkeyhint: 'send' })
    this.input.addEventListener('input', () => this.grow())
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.submit() } })
    this.sendBtn = h('button', { class: 'btn primary icon lx-send', type: 'submit', 'aria-label': 'Send message', title: 'Send' }, icon('send', 20))
    this.chips = h('div', { class: 'lx-chips', role: 'group', 'aria-label': 'Suggestions' })
    const panel = h('section', { class: 'lx-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'LUNEX assistant', tabIndex: -1 },
      h('header', { class: 'lx-head' },
        h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Close LUNEX', title: 'Close', onclick: () => this.close() }, icon('back')),
        h('span', { class: 'avatar sm lunex-av', 'aria-hidden': 'true' }, icon('sparkle', 20)),
        h('div', { class: 'lx-title' }, h('h2', {}, 'LUNEX'), this.sub),
        h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Clear conversation', title: 'Clear conversation', onclick: () => this.clear() }, icon('trash'))),
      this.log, this.chips,
      h('form', { class: 'lx-form', onsubmit: (e) => { e.preventDefault(); this.submit() } }, this.input, this.sendBtn),
      h('p', { class: 'lx-note' }, 'LUNEX is an AI and can make mistakes. Don\'t share passwords or secrets. Messages here are sent to LUNEX and its AI provider.'))
    this.el = h('div', { class: 'lx-wrap' }, h('div', { class: 'lx-backdrop', onclick: () => this.close() }), panel)
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close() } })
    document.body.append(this.el)
    this.draw()
    this.input.focus()
  }

  close() {
    if (!this.el) return
    this.el.remove(); this.el = null
    this.prev?.focus?.()
    this.ctx.renderRooms?.()
  }

  async clear() {
    if (!(await confirmDialog('Clear conversation?', 'This removes your LUNEX chat from this device.', 'Clear', true))) return
    this.turns = []; this.save(); this.draw()
  }

  /* ---------- drawing ---------- */
  grow() { this.input.style.height = 'auto'; this.input.style.height = Math.min(this.input.scrollHeight, 140) + 'px' }
  scroll() { this.log.scrollTop = this.log.scrollHeight }

  bubble(role, text, sources) {
    const body = h('div', { class: 'lx-text' }, text)
    const row = h('div', { class: `lx-msg ${role}` }, body)
    if (sources?.length) row.append(this.sourcesEl(sources))
    this.log.append(row)
    return { row, body }
  }

  sourcesEl(sources) {
    const box = h('div', { class: 'lx-sources' })
    for (const s of sources.slice(0, 6)) {
      const href = s.url ? safeHref(s.url) : null
      const label = String(s.title || href || 'Source').slice(0, 80)
      box.append(href ? h('a', { class: 'lx-src', href, target: '_blank', rel: 'noopener noreferrer' }, '↗ ' + label) : h('span', { class: 'lx-src plain' }, label))
    }
    return box
  }

  draw() {
    clear(this.log); clear(this.chips)
    if (!this.turns.length) {
      this.log.append(h('div', { class: 'lx-welcome' }, h('span', { class: 'avatar xl lunex-av', 'aria-hidden': 'true' }, icon('sparkle', 38)),
        h('h3', {}, 'Hi, I\'m LUNEX'), h('p', { class: 'small' }, 'I can answer questions about LSDKChat, research topics on the web, summarize text or links, translate, and more.')))
      for (const [text, label, fill] of CHIPS) {
        this.chips.append(h('button', { class: 'fchip', type: 'button', onclick: () => { if (fill) { this.input.value = text; this.grow(); this.input.focus() } else this.submit(text) } }, label || text))
      }
    }
    for (const t of this.turns) this.bubble(t.role, t.text, t.sources)
    this.scroll()
  }

  setStatus(text) { if (!this.status) this.status = h('div', { class: 'lx-status', 'aria-live': 'polite' }); this.status.textContent = text; if (!this.status.isConnected) this.log.append(this.status); this.scroll() }
  clearStatus() { this.status?.remove(); this.status = null }

  /* ---------- sending ---------- */
  summarize(title, context) {
    this.open()
    const n = context?.messages?.length || 0
    return this.submit('Summarize this chat', { skill: 'summarize', context, display: `Summarize "${String(title).slice(0, 40)}" (last ${n} messages)` })
  }

  async submit(textArg, extra = {}) {
    if (this.busy) return
    const text = String(textArg ?? this.input.value).trim().slice(0, 2000)
    if (!text) return
    this.busy = true; this.sendBtn.disabled = true
    const first0 = !this.turns.length
    if (first0) { clear(this.log); clear(this.chips) }
    this.input.value = ''; this.grow()
    const history = toHistory(this.turns)
    this.turns.push({ role: 'user', text: extra.display || text })
    this.bubble('user', extra.display || text)
    const { row, body } = this.bubble('assistant', '')
    body.classList.add('typing'); body.append(h('span', { class: 'dots', 'aria-label': 'LUNEX is typing' }, h('i'), h('i'), h('i')))
    this.scroll()
    let acc = '', started = false
    const wakeT = setTimeout(() => { if (!started && !this.status) this.setStatus('LUNEX is waking up… the first reply can take up to a minute.') }, 7000)
    try {
      const r = await this.client.ask(text, {
        history, skill: extra.skill, context: extra.context,
        onStatus: (t) => this.setStatus(t),
        onDelta: (d) => { if (!started) { started = true; body.classList.remove('typing'); clear(body); this.clearStatus() } acc += d; body.textContent = acc; if (this.el) this.scroll() },
      })
      const reply = r.reply || acc || 'Sorry, I had nothing to say to that.'
      body.classList.remove('typing'); body.textContent = reply
      if (r.sources?.length) row.append(this.sourcesEl(r.sources))
      this.turns.push({ role: 'assistant', text: reply, sources: (r.sources || []).slice(0, 6) })
      if (r.remainingToday != null) { this.remaining = r.remainingToday; if (this.sub) this.sub.textContent = `${r.remainingToday} messages left today` }
    } catch (e) {
      body.classList.remove('typing'); row.classList.add('lx-error'); clear(body); body.textContent = e.message || 'LUNEX is not available right now.'
      if (e.status === 401) toast('Please sign in again to use LUNEX.', 'error')
    } finally {
      clearTimeout(wakeT); this.clearStatus()
      this.save(); this.busy = false
      if (this.sendBtn) this.sendBtn.disabled = false
      if (this.el) { this.scroll(); this.input.focus() }
    }
  }
}
