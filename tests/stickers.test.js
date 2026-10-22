// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../src/lib/supabase.js', () => ({ supabase: { auth: { onAuthStateChange: vi.fn(), getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))
vi.mock('../src/config.js', () => ({ CONFIG: { lunexUrl: 'https://lunex.example' } }))
const lib = await import('../src/lib/stickers.js')
const { StickerPanel } = await import('../src/ui/sticker-panel.js')
const { fitRect } = await import('../src/ui/sticker-creator.js')

const item = (n) => ({ id: 's' + n, title: 'Dance ' + n, url: `https://static.klipy.com/${n}.webp`, preview: `https://static.klipy.com/${n}-sm.webp` })
const api = (impl = {}) => ({ enabled: true, wake: vi.fn(), trending: vi.fn(async () => ({ items: [item(1), item(2)], hasNext: true })), search: vi.fn(async (q) => ({ items: [item(9)], hasNext: false })), ...impl })
const ctx = () => ({ me: { id: 'u1' }, sendSticker: vi.fn(), sendMySticker: vi.fn(), stickerBtn: document.createElement('button') })
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
beforeEach(() => { localStorage.clear(); document.body.innerHTML = '' })

describe('sticker messages', () => {
  it('only shows https klipy.com stickers', () => {
    const good = lib.stickerContent('https://static.klipy.com/a/b.webp')
    expect(lib.stickerUrl(good)).toBe('https://static.klipy.com/a/b.webp')
    for (const bad of ['[sticker]http://static.klipy.com/a.webp', '[sticker]https://evil.example/a.webp', '[sticker]https://klipy.com.evil.example/a', '[sticker]javascript:alert(1)', '[sticker]https://u:p@static.klipy.com/a', 'hello [sticker]https://static.klipy.com/a', '[sticker]'])
      expect(lib.stickerUrl(bad)).toBeNull()
    expect(lib.isStickerPreview('[sticker]https://static.klipy.com/a-cut-off-by-a-preview')).toBe(true)
    expect(lib.isStickerFile({ attachment_name: 'sticker.webp', attachment_type: 'image/webp' })).toBe(true)
    expect(lib.isStickerFile({ attachment_name: 'photo.webp', attachment_type: 'image/webp' })).toBe(false)
  })
  it('geometry: fit keeps the whole picture, fill covers the square', () => {
    expect(fitRect(400, 200, 512, 'fit')).toMatchObject({ dw: 512, dh: 256, dx: 0, dy: 128 })
    expect(fitRect(400, 200, 512, 'fill')).toMatchObject({ dw: 1024, dh: 512, dx: -256, dy: 0 })
  })
})

describe('sticker picker', () => {
  it('shows trending stickers, sends one, remembers it as recent, and handles favourites', async () => {
    const c = ctx(), a = api(); const p = new StickerPanel(c, a); document.body.append(p.el)
    p.show(); await tick()
    expect(a.wake).toHaveBeenCalled(); expect(p.el.hidden).toBe(false)
    expect(p.grid.querySelectorAll('.stk-item').length).toBe(2); expect(p.grid.querySelector('.stk-create').textContent).toContain('Create')
    expect(p.el.textContent).toContain('powered by KLIPY'.replace('powered', 'Stickers powered'))
    expect(p.grid.querySelector('img').getAttribute('referrerpolicy')).toBe('no-referrer')
    p.grid.querySelectorAll('.stk-mini')[0].click()                                       // favourite the first one
    expect(JSON.parse(localStorage.getItem('lsdk.stk.fav.u1'))[0].url).toContain('1.webp')
    p.grid.querySelectorAll('.stk-item')[1].click()
    expect(c.sendSticker).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://static.klipy.com/2.webp' })); expect(p.el.hidden).toBe(true)
    expect(JSON.parse(localStorage.getItem('lsdk.stk.recent.u1')).length).toBe(1)
    const p2 = new StickerPanel(c, api()); document.body.append(p2.el); p2.show(); await tick()   // reopening starts on Recent
    expect(p2.tab).toBe('recent'); expect(p2.grid.querySelectorAll('.stk-item').length).toBe(1)
  })
  it('searches, loads more, and shows friendly errors', async () => {
    const a = api(); const p = new StickerPanel(ctx(), a); document.body.append(p.el); p.show(); await tick()
    p.search.value = 'cat'; p.onSearch(); await tick()
    expect(a.search).toHaveBeenCalledWith('cat', 1); expect(p.grid.querySelectorAll('.stk-item').length).toBe(1)
    p.search.value = 'x'; p.onSearch(); expect(a.search).toHaveBeenCalledTimes(1)                  // one letter is ignored
    const bad = api({ trending: vi.fn(async () => { throw new Error('Stickers are unavailable right now.') }) })
    const p2 = new StickerPanel(ctx(), bad); document.body.append(p2.el); p2.show(); await tick()
    expect(p2.status.textContent).toBe('Stickers are unavailable right now.')
    const p3 = new StickerPanel(ctx(), api({ enabled: false })); document.body.append(p3.el); p3.show(); await tick()
    expect(p3.status.textContent).toContain('not available')
  })
  it('My stickers: saved ones can be sent and deleted', async () => {
    const c = ctx(); globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn()
    await lib.mineAdd('u1', new Blob(['x'], { type: 'image/webp' }))
    const p = new StickerPanel(c, api()); document.body.append(p.el); p.show(); p.setTab('mine'); await tick(20)
    expect(p.grid.querySelectorAll('.stk-item').length).toBe(1)
    p.grid.querySelector('.stk-item').click(); expect(c.sendMySticker).toHaveBeenCalled()
    p.show(); p.setTab('mine'); await tick(20); p.grid.querySelector('.stk-mini').click(); await tick(20)
    expect((await lib.mineList('u1')).length).toBe(0)
  })
})

describe('sticker client', () => {
  it('asks the LUNEX server (never KLIPY directly) and drops anything not on klipy.com', async () => {
    let seen
    globalThis.fetch = vi.fn(async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ has_next: true, items: [item(1), { id: 'x', title: 'bad', url: 'https://evil.example/a.webp', preview: 'https://evil.example/a.webp' }] }), { status: 200 }) })
    const r = await new lib.StickerApi().search('dance floor', 2)
    expect(String(seen.url)).toBe('https://lunex.example/v1/stickers/search?q=dance+floor&page=2'); expect(seen.init.headers.Authorization).toBe('Bearer t')
    expect(r.items.length).toBe(1); expect(r.hasNext).toBe(true)
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ detail: 'Slow down a little.' }), { status: 429 }))
    await expect(new lib.StickerApi().trending()).rejects.toThrow('Slow down a little.')
    globalThis.fetch = vi.fn(async () => { throw new TypeError('offline') })
    await expect(new lib.StickerApi().trending()).rejects.toThrow(/Could not reach/)
  })
})
