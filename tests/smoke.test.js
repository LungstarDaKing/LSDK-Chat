// @vitest-environment jsdom
// UI smoke tests against a fake Supabase client (no network). They check that every
// page renders, validation works, and user-supplied text can never become HTML.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ME = { id: 'u1', username: 'alice', terms_version: '2026-10-07', terms_accepted_at: new Date().toISOString(), created_at: new Date().toISOString() }
const fixtures = {
  profiles: [ME],
  rooms: [{ id: 'r1', name: 'Team', is_direct: false, last_message_at: new Date().toISOString(),
    participants: [{ profile_id: 'u1', role: 'admin', joined_at: '', profiles: { username: 'alice' } }, { profile_id: 'u2', role: 'member', joined_at: '', profiles: { username: 'bob<b>' } }] }],
  messages: [{ id: 'm1', room_id: 'r1', sender_id: 'u2', content: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>', created_at: new Date().toISOString(), edited_at: null }],
}
const calls = []
function builder(table) {
  const b = new Proxy({}, { get(_, prop) {
    if (prop === 'then') return (res) => res({ data: fixtures[table] ?? [], error: null })
    if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: (fixtures[table] ?? [])[0] ?? null, error: null })
    return (...args) => { calls.push([table, prop, args]); return b }
  } })
  return b
}
const authHandlers = []
const fakeSupabase = {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'a@b.co' } } } })),
    onAuthStateChange: vi.fn((cb) => { authHandlers.push(cb); return { data: { subscription: { unsubscribe() {} } } } }),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => ({})), updateUser: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })), resend: vi.fn(async () => ({ error: null })),
  },
  from: vi.fn((t) => builder(t)),
  rpc: vi.fn(async () => ({ data: null, error: null })),
  channel: vi.fn(() => { const c = { on: () => c, subscribe: () => c }; return c }),
  removeChannel: vi.fn(),
}
vi.mock('../src/lib/supabase.js', () => ({ supabase: fakeSupabase, appUrl: () => 'https://x.github.io/LSDKChat/' }))

const flush = () => new Promise((r) => setTimeout(r, 20))
beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; window.__pwned = 0; calls.length = 0; vi.clearAllMocks() })

describe('legal pages', () => {
  it('render all three documents and flag missing operator details', async () => {
    const { renderLegal } = await import('../src/pages/legal.js')
    const root = document.getElementById('app')
    for (const n of ['terms', 'privacy', 'disclosures']) {
      renderLegal(root, n, false)
      expect(root.querySelector('h1').textContent.length).toBeGreaterThan(5)
      expect(root.querySelectorAll('section').length).toBeGreaterThan(5)
      expect(root.textContent).toContain('Operator details are not filled in')
    }
  })
})

describe('auth page', () => {
  it('registration needs both consent boxes and a valid username/password', async () => {
    const { renderAuth } = await import('../src/pages/auth.js')
    const root = document.getElementById('app')
    renderAuth(root, 'register')
    expect(root.querySelector('#age').required && root.querySelector('#agree').required).toBe(true)
    root.querySelector('#email').value = 'a@b.co'; root.querySelector('#username').value = 'ab'; root.querySelector('#password').value = 'short'
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(root.querySelector('.msg').textContent).toMatch(/Username must be/)
    expect(fakeSupabase.auth.signUp).not.toHaveBeenCalled()
    root.querySelector('#username').value = 'alice_1'; root.querySelector('#password').value = 'a-long-enough-pass'
    root.querySelector('#age').checked = true; root.querySelector('#agree').checked = true
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    const arg = fakeSupabase.auth.signUp.mock.calls[0][0]
    expect(arg.options.data).toEqual({ username: 'alice_1', terms_version: '2026-10-07' })
    expect(root.textContent).toMatch(/Check your email/)
  })
  it('login shows a generic message for bad credentials', async () => {
    fakeSupabase.auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    const { renderAuth } = await import('../src/pages/auth.js')
    const root = document.getElementById('app'); renderAuth(root, 'login')
    root.querySelector('#email').value = 'a@b.co'; root.querySelector('#password').value = 'x'
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(root.querySelector('.msg').textContent).toBe('Wrong email or password.')
  })
})

describe('chat page', () => {
  it('renders rooms and shows hostile message text as inert text', async () => {
    const { state } = await import('../src/lib/state.js')
    state.session = { user: { id: 'u1', email: 'a@b.co' } }; state.profile = ME
    const { renderChat, teardownChat } = await import('../src/pages/chat.js')
    const root = document.getElementById('app')
    renderChat(root, 'r1'); await flush(); await flush()
    expect(root.querySelector('.room-name').textContent).toBe('Team')
    const text = root.querySelector('.msg-row .text')
    expect(text.textContent).toContain('<img src=x onerror=')
    expect(root.querySelector('.messages img, .messages script')).toBeNull()
    expect(window.__pwned).toBe(0)
    expect(root.querySelector('.pane-sub').textContent).toBe('alice, bob<b>')   // member names also inert
    expect(root.querySelector('.msg-row.other .msg-actions').textContent).toMatch(/Report/)
    teardownChat()
  })
})

describe('profile page', () => {
  it('offers export and deletion', async () => {
    const { state } = await import('../src/lib/state.js')
    state.session = { user: { id: 'u1', email: 'a@b.co' } }; state.profile = ME
    const { renderProfile } = await import('../src/pages/profile.js')
    const root = document.getElementById('app'); renderProfile(root)
    expect(root.textContent).toMatch(/Download my data/); expect(root.textContent).toMatch(/Delete my account/)
    expect(root.textContent).toContain('a@b.co')
  })
})
