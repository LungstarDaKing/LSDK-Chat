// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../src/lib/supabase.js', () => ({ supabase: { auth: { onAuthStateChange: vi.fn(), getSession: async () => ({ data: { session: { access_token: 't' } } }) } }, appUrl: () => '' }))
const { LunexPanel } = await import('../src/ui/lunex-ui.js')
const { LunexClient, LunexError, toHistory, chatContext } = await import('../src/lib/lunex.js')

const ctx = { me: { id: 'u1' }, renderRooms: vi.fn() }
const fakeClient = (impl) => ({ ask: vi.fn(impl), wake: vi.fn() })
beforeEach(() => { localStorage.clear(); document.body.innerHTML = '' })

describe('LUNEX chat window', () => {
  it('sends a message, streams the reply as inert text, shows safe source links, remembers the chat', async () => {
    const client = fakeClient(async (text, o) => {
      o.onStatus?.('Searching the web…'); o.onDelta('Hello <img src=x onerror=alert(1)> ')
      o.onDelta('world'); return { reply: 'Hello <img src=x onerror=alert(1)> world', skill: 'research', remainingToday: 41,
        sources: [{ title: 'Good', url: 'https://ok.example/a' }, { title: 'Bad', url: 'javascript:alert(1)' }, { title: 'Help: Calls' }] }
    })
    const p = new LunexPanel(ctx, client); p.open()
    expect(client.wake).toHaveBeenCalled(); expect(document.querySelector('.lx-welcome')).toBeTruthy()
    p.input.value = '/research tea'; await p.submit()
    const bot = document.querySelector('.lx-msg.assistant')
    expect(bot.querySelector('.lx-text').textContent).toBe('Hello <img src=x onerror=alert(1)> world')
    expect(document.querySelector('.lx-panel img')).toBeNull()                         // never parsed as HTML
    const links = [...bot.querySelectorAll('a.lx-src')]
    expect(links.map((a) => a.href)).toEqual(['https://ok.example/a'])                  // javascript: link is not a link
    expect(links[0].rel).toContain('noopener'); expect(bot.querySelectorAll('.lx-src.plain').length).toBe(2)
    expect(document.querySelector('.lx-sub').textContent).toContain('41 messages left')
    expect(JSON.parse(localStorage.getItem('lsdk.lunex.u1')).length).toBe(2)
    expect(client.ask.mock.calls[0][1].history).toEqual([])
    // second message carries the history
    await p.submit('and coffee?')
    expect(client.ask.mock.calls[1][1].history.map((t) => t.role)).toEqual(['user', 'assistant'])
    p.close(); expect(document.querySelector('.lx-wrap')).toBeNull()
    const again = new LunexPanel(ctx, client); expect(again.preview()).toContain('Hello'); again.open()
    expect(document.querySelectorAll('.lx-msg').length).toBe(4)                         // conversation restored
    again.close()
  })

  it('shows friendly errors without saving them as replies', async () => {
    const client = fakeClient(async () => { throw new LunexError('You\'re sending messages too fast. Wait a few seconds.', 429, 5) })
    const p = new LunexPanel(ctx, client); p.open(); await p.submit('hi')
    expect(document.querySelector('.lx-msg.lx-error').textContent).toContain('too fast')
    expect(p.turns.map((t) => t.role)).toEqual(['user']); expect(p.busy).toBe(false)
    p.close()
  })

  it('summarize sends only the context it is given and displays a short label', async () => {
    const client = fakeClient(async () => ({ reply: 'Summary.', skill: 'summarize', sources: [] }))
    const p = new LunexPanel(ctx, client)
    await p.summarize('Team', { messages: [{ author: 'Ana', text: 'hi' }] })
    const [text, opts] = client.ask.mock.calls[0]
    expect(text).toBe('Summarize this chat'); expect(opts.skill).toBe('summarize'); expect(opts.context.messages[0].text).toBe('hi')
    expect(p.turns[0].text).toContain('Summarize "Team" (last 1 messages)')            // the chat text itself is not stored
    expect(JSON.stringify(p.turns)).not.toContain('"hi"')
    p.close()
  })

  it('ignores corrupt saved data and keeps only valid turns', () => {
    localStorage.setItem('lsdk.lunex.u1', JSON.stringify([{ role: 'system', text: 'x' }, { role: 'user', text: 5 }, { role: 'user', text: 'ok' }]))
    expect(new LunexPanel(ctx, fakeClient(async () => ({}))).turns).toEqual([{ role: 'user', text: 'ok' }])
    localStorage.setItem('lsdk.lunex.u1', '{not json'); expect(new LunexPanel(ctx, fakeClient(async () => ({}))).turns).toEqual([])
  })
})

describe('LUNEX client', () => {
  it('parses the live stream, sends the login token, and maps errors to friendly messages', async () => {
    const enc = new TextEncoder()
    const sse = ['event: status\ndata: {"type":"status","text":"Searching the web…"}\n\n', 'event: delta\ndata: {"type":"delta","text":"Hi "}\n\n',
      'event: delta\ndata: {"type":"delta","text":"there"}\n\n', 'event: done\ndata: {"type":"done","skill":"chat","sources":[],"remaining_today":7}\n\n']
    let seen
    globalThis.fetch = vi.fn(async (url, init) => { seen = { url, init }; return new Response(new ReadableStream({ start(c) { sse.forEach((x) => c.enqueue(enc.encode(x))); c.close() } }), { status: 200 }) })
    const c = new LunexClient({ baseUrl: 'https://x.example/', getToken: async () => 'tok' })
    const got = []; const r = await c.ask('hi', { history: [{ role: 'user', text: 'a' }], onStatus: (t) => got.push(t), onDelta: (t) => got.push(t) })
    expect(r).toMatchObject({ reply: 'Hi there', skill: 'chat', remainingToday: 7 }); expect(got).toEqual(['Searching the web…', 'Hi ', 'there'])
    expect(seen.url).toBe('https://x.example/v1/chat/stream'); expect(seen.init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(seen.init.body).history).toEqual([{ role: 'user', content: 'a' }])
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ detail: 'Slow down' }), { status: 429, headers: { 'retry-after': '9' } }))
    await expect(c.ask('hi')).rejects.toMatchObject({ message: 'Slow down', status: 429, retryAfter: 9 })
    globalThis.fetch = vi.fn(async () => { throw new TypeError('offline') })
    await expect(c.ask('hi')).rejects.toThrow(/Could not reach LUNEX/)
    await expect(new LunexClient({ baseUrl: 'https://x', getToken: async () => null }).ask('hi')).rejects.toMatchObject({ status: 401 })
  })
  it('helpers trim history and build chat context', () => {
    expect(toHistory(Array.from({ length: 30 }, (_, i) => ({ role: 'user', text: 'm' + i })), 12).length).toBe(12)
    expect(chatContext([{ sender_id: 'a', content: 'hi' }, { sender_id: 'a', content: 'gone', deleted_at: 'x' }, { sender_id: 'b', content: '' }], (id) => id.toUpperCase()).messages).toEqual([{ author: 'A', text: 'hi' }])
  })
})
