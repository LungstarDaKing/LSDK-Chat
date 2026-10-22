import { h, clear, debounce } from '../lib/dom.js'
import { icon } from './icons.js'
import { StickerApi, listStore, mineList, mineAdd, mineRemove, wireSignOutWipe } from '../lib/stickers.js'
import { openStickerCreator } from './sticker-creator.js'

const TABS = [['recent', 'Recent', 'clock'], ['fav', 'Favourites', 'star'], ['trending', 'Trending', 'sparkle'], ['mine', 'My stickers', 'smile']]

// The sticker picker that opens above the message box (like WhatsApp's).
export class StickerPanel {
  constructor(ctx, api = new StickerApi()) {
    this.ctx = ctx; this.api = api; this.tab = 'trending'; this.q = ''; this.page = 1; this.items = []; this.hasNext = false; this.token = 0; this.urls = []; this.started = false
    wireSignOutWipe()
    this.recent = listStore('recent', ctx.me.id, 30)
    this.fav = listStore('fav', ctx.me.id, 120)
    this.search = h('input', { type: 'search', class: 'stk-search', placeholder: 'Search stickers', 'aria-label': 'Search stickers', maxLength: 60, autocomplete: 'off', oninput: debounce(() => this.onSearch(), 400) })
    this.tabs = h('div', { class: 'stk-tabs', role: 'tablist', 'aria-label': 'Sticker groups' })
    this.grid = h('div', { class: 'stk-grid', role: 'list' })
    this.status = h('div', { class: 'stk-status', role: 'status', 'aria-live': 'polite' })
    this.more = h('button', { class: 'btn small', type: 'button', hidden: true, onclick: () => this.load(false) }, 'Load more')
    this.el = h('div', { class: 'stk-panel', hidden: true, role: 'dialog', 'aria-label': 'Stickers' },
      h('div', { class: 'stk-head' }, this.search, h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Close stickers', title: 'Close', onclick: () => this.hide() }, icon('x', 18))),
      this.tabs, h('div', { class: 'stk-body' }, this.grid, this.status, this.more), h('div', { class: 'stk-foot' }, 'Stickers powered by KLIPY'))
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.hide(); this.ctx.stickerBtn?.focus() } })
    this.drawTabs()
  }

  toggle() { this.el.hidden ? this.show() : this.hide() }
  show() {
    this.el.hidden = false
    if (!this.started) { this.started = true; this.api.wake?.(); this.setTab(this.recent.load().length ? 'recent' : 'trending') }
    this.search.focus()
  }
  hide() { this.el.hidden = true; this.free() }
  free() { for (const u of this.urls) URL.revokeObjectURL(u); this.urls = [] }

  drawTabs() {
    clear(this.tabs)
    for (const [id, label, ico] of TABS) {
      this.tabs.append(h('button', { class: `stk-tab${this.tab === id ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), 'aria-label': label, title: label, onclick: () => this.setTab(id) }, icon(ico, 18)))
    }
  }
  setTab(t) { this.tab = t; this.q = ''; this.search.value = ''; this.drawTabs(); this.load(true) }
  onSearch() {
    const q = this.search.value.trim()
    if (q.length === 1) return
    this.q = q; this.tab = 'trending'; this.drawTabs(); this.load(true)
  }

  async load(reset) {
    const my = ++this.token
    if (reset) { this.page = 1; this.items = []; this.hasNext = false; this.free() }
    this.status.textContent = ''
    if (this.tab === 'recent') this.items = this.recent.load()
    else if (this.tab === 'fav') this.items = this.fav.load()
    else if (this.tab === 'mine') {
      const mine = await mineList(this.ctx.me.id); if (my !== this.token) return
      this.items = mine.map((m) => { const u = URL.createObjectURL(m.blob); this.urls.push(u); return { id: m.id, mine: true, blob: m.blob, url: u, preview: u, title: 'My sticker' } })
    } else {
      if (!this.api.enabled) { this.status.textContent = 'Stickers are not available.'; return this.render() }
      this.status.textContent = this.started && this.page === 1 ? 'Loading stickers… (the first time can take up to a minute)' : 'Loading…'
      this.more.hidden = true
      try {
        const r = this.q ? await this.api.search(this.q, this.page) : await this.api.trending(this.page)
        if (my !== this.token) return
        this.items = this.items.concat(r.items); this.hasNext = r.hasNext; this.page += 1
        this.status.textContent = this.items.length ? '' : (this.q ? 'No stickers found. Try another word.' : 'No stickers right now.')
      } catch (e) { if (my !== this.token) return; this.status.textContent = e.message }
    }
    if (this.tab !== 'trending' && !this.items.length) this.status.textContent = { recent: 'Stickers you send will show up here.', fav: 'Tap the star on a sticker to keep it here.', mine: 'Make your own with Create.' }[this.tab] || ''
    this.render()
  }

  render() {
    clear(this.grid)
    this.grid.append(h('div', { class: 'stk-cell', role: 'listitem' }, h('button', { class: 'stk-create', type: 'button', onclick: () => this.create() }, icon('plus', 22), h('span', {}, 'Create'))))
    for (const it of this.items) {
      const isFav = !it.mine && this.fav.has(it.url)
      const cell = h('div', { class: 'stk-cell', role: 'listitem' },
        h('button', { class: 'stk-item', type: 'button', 'aria-label': `Send sticker: ${it.title}`, onclick: () => this.pick(it) },
          h('img', { src: it.preview || it.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })))
      if (it.mine) cell.append(h('button', { class: 'stk-mini', type: 'button', 'aria-label': 'Delete this sticker', title: 'Delete', onclick: async () => { await mineRemove(it.id); this.load(true) } }, icon('trash', 14)))
      else cell.append(h('button', { class: `stk-mini${isFav ? ' on' : ''}`, type: 'button', 'aria-label': isFav ? 'Remove from favourites' : 'Add to favourites', 'aria-pressed': String(isFav), title: isFav ? 'Unfavourite' : 'Favourite',
        onclick: () => { isFav ? this.fav.remove(it.url) : this.fav.add(it); this.tab === 'fav' ? this.load(true) : this.render() } }, icon('star', 14)))
      this.grid.append(cell)
    }
    this.more.hidden = !(this.tab === 'trending' && this.hasNext)
  }

  pick(it) {
    this.hide()
    if (it.mine) return this.ctx.sendMySticker(it.blob)
    this.recent.add(it)
    this.ctx.sendSticker(it)
  }
  create() {
    openStickerCreator({ onDone: async (blob, send) => {
      await mineAdd(this.ctx.me.id, blob)
      if (send) { this.hide(); this.ctx.sendMySticker(blob) } else this.setTab('mine')
    } })
  }
}
