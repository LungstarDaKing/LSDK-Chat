// @vitest-environment jsdom
// Watch together: the button and banner exist and are wired into the chat page (this broke once when an old chat.js was pasted over),
// and "any link" is inspected before anything is shared or opened.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { rpc, invoke, fakeSupabase } = vi.hoisted(() => {
  const rpc = vi.fn(async () => ({ data: null, error: null }))
  const invoke = vi.fn(async () => ({ data: { checked: true, threat: null }, error: null }))
  const fakeSupabase = {
    rpc, functions: { invoke },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c }, removeChannel: () => {},
  }
  return { rpc, invoke, fakeSupabase }
})
vi.mock('../src/lib/supabase.js', () => ({ supabase: fakeSupabase, appUrl: () => 'https://x.test/' }))

import { WatchController, WatchPanel } from '../src/ui/watch-ui.js'

const direct = { id: 'r1', is_direct: true, notes_owner: null }
const flush = () => new Promise((r) => setTimeout(r, 30))
if (!HTMLDialogElement.prototype.showModal) { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) } }
beforeEach(() => { document.body.innerHTML = ''; rpc.mockClear(); invoke.mockClear() })

describe('chat page wiring (regression guard)', () => {
  const chat = readFileSync(resolve(process.cwd(), 'src/pages/chat.js'), 'utf8')
  it('creates the controller and shows its button and banner in the chat', () => {
    expect(chat).toMatch(/new WatchController\(this\)/)
    expect(chat).toMatch(/this\.watch\.btn/)
    expect(chat).toMatch(/this\.watch\.banner/)
    expect(chat).toMatch(/this\.watch\.setRoom\(/)
    expect(chat).toMatch(/watchWith\(peerId\)/)
  })
  it('keeps the other things that were lost once: sign-in animation and Access granted', () => {
    const auth = readFileSync(resolve(process.cwd(), 'src/pages/auth.js'), 'utf8')
    const main = readFileSync(resolve(process.cwd(), 'src/main.js'), 'utf8')
    expect(auth).toMatch(/startKonnect\(/); expect(auth).toMatch(/armAccess\(\)/)
    expect(main).toMatch(/playAccessGranted\(/); expect(main).toMatch(/motion\.css/)
  })
  it('the page security rules allow the players', () => {
    const cfg = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')
    expect(cfg).not.toMatch(/frame-src 'none'/)
  })
})

describe('WatchController', () => {
  const ctx = { me: { id: 'u1' }, nameOf: (x) => x, releaseIfDone() {} }
  it('is visible only in a chat between two people', () => {
    const c = new WatchController(ctx)
    c.setRoom({ id: 'g1', is_direct: false, notes_owner: null }); expect(c.btn.hidden).toBe(true)
    c.setRoom(direct); expect(c.btn.hidden).toBe(false)
    c.setRoom({ id: 'n1', is_direct: true, notes_owner: 'u1' }); expect(c.btn.hidden).toBe(true)
    c.destroy()
  })
  it('refuses a dangerous link inside the dialog and never calls the database', async () => {
    const c = new WatchController(ctx); c.setRoom(direct)
    c.startDialog('r1')
    const input = document.querySelector('input[type=url]'); input.value = 'https://bit.ly/abc123'
    const start = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Start'); start.click(); await flush()
    expect(document.body.textContent).toMatch(/not opened/)
    expect(rpc).not.toHaveBeenCalledWith('watch_start', expect.anything())
    c.destroy()
  })
  it('refuses a link Google Safe Browsing lists, before sharing it', async () => {
    invoke.mockResolvedValueOnce({ data: { checked: true, threat: 'SOCIAL_ENGINEERING' }, error: null })
    const c = new WatchController(ctx); c.setRoom(direct)
    c.startDialog('r1')
    document.querySelector('input[type=url]').value = 'https://watch.example-videos.net/v/1'
    ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Start').click(); await flush()
    expect(document.body.textContent).toMatch(/Safe Browsing/)
    expect(rpc).not.toHaveBeenCalledWith('watch_start', expect.anything())
    c.destroy()
  })
})

describe('the player for a shared web link', () => {
  const ctx = { me: { id: 'u1' }, nameOf: (x) => x, rooms: [direct], peerOf: () => 'u2' }
  const ctl = { panelClosed() {}, startDialog() {} }
  const row = (id) => ({ room_id: 'r1', provider: 'web', media_id: id, host: 'u2', controllers: ['u2'], requests: [], playing: false, pos: 0, cd: 0, version: 1 })
  it('opens a normal page in a locked-down frame', async () => {
    const p = new WatchPanel(ctx, ctl, 'r1', row('https://vimeo.com/76979871')); await flush()
    const f = p.frameBox.querySelector('iframe')
    expect(f.getAttribute('src')).toBe('https://vimeo.com/76979871')
    expect(f.getAttribute('sandbox')).not.toMatch(/allow-popups|allow-top-navigation|allow-downloads/)
    expect(f.getAttribute('referrerpolicy')).toBe('no-referrer')
    p.close()
  })
  it('never opens a dangerous address, even if the other side stored it', async () => {
    const p = new WatchPanel(ctx, ctl, 'r1', row('https://bit.ly/abc123')); await flush()
    expect(p.frameBox.querySelector('iframe')).toBeNull()
    expect(p.frameBox.querySelector('.wp-webmsg.danger')?.textContent).toMatch(/Link blocked/)
    expect(invoke).not.toHaveBeenCalled()
    p.close()
  })
  it('does not open a page Google lists as dangerous', async () => {
    invoke.mockResolvedValueOnce({ data: { checked: true, threat: 'MALWARE' }, error: null })
    const p = new WatchPanel(ctx, ctl, 'r1', row('https://cool-videos.example.net/v')); await flush()
    expect(p.frameBox.querySelector('iframe')).toBeNull()
    expect(p.frameBox.textContent).toMatch(/malware/i)
    p.close()
  })
  it('asks first for a link with warning signs', async () => {
    const p = new WatchPanel(ctx, ctl, 'r1', row('https://cool-videos.xyz/watch')); await flush()
    expect(p.frameBox.querySelector('iframe')).toBeNull()
    const open = [...p.frameBox.querySelectorAll('.wp-webmsg.warn button')][0]; open.click()
    expect(p.frameBox.querySelector('iframe')).not.toBeNull()
    p.close()
  })
})
