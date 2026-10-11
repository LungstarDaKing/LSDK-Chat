// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../src/lib/supabase.js', () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) }, auth: {} } }))

import { linksIn, safeHref } from '../src/pages/tools.js'
import { previewText, quickTimes, toLocalInput } from '../src/lib/tools.js'
import { getA11y, setA11y } from '../src/lib/a11y.js'
import { commandOf } from '../src/lib/dictation.js'

describe('links', () => {
  it('finds links and trims trailing punctuation', () => {
    expect(linksIn('see https://a.com/x, and http://b.org/y). done')).toEqual(['https://a.com/x', 'http://b.org/y'])
  })
  it('only allows http(s) hrefs', () => {
    expect(safeHref('https://a.com')).toBe('https://a.com/')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,hi')).toBeNull()
  })
})

describe('helpers', () => {
  it('previewText handles files, long text, deleted', () => {
    expect(previewText(null)).toBe('Message deleted')
    expect(previewText({ content: '', attachment_name: 'voice-note.wav' })).toBe('🎤 Voice note')
    expect(previewText({ content: 'x'.repeat(300) }, 50).length).toBe(50)
  })
  it('quick times are in the future and datetime-local formatted', () => {
    for (const q of quickTimes()) expect(q.date.getTime()).toBeGreaterThan(Date.now())
    expect(toLocalInput(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07')
  })
})

describe('accessibility prefs', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('style'); document.documentElement.removeAttribute('data-contrast') })
  it('has safe defaults', () => { expect(getA11y()).toMatchObject({ size: 100, contrast: 'normal', motion: 'system', announce: true }) })
  it('applies text size, contrast and motion', () => {
    setA11y('size', 130); setA11y('contrast', 'high'); setA11y('motion', 'reduce')
    expect(document.documentElement.style.fontSize).toBe('130%')
    expect(document.documentElement.dataset.contrast).toBe('high')
    expect(document.documentElement.dataset.motion).toBe('reduce')
  })
  it('ignores junk stored values', () => {
    localStorage.setItem('lsdkchat.a11y', JSON.stringify({ size: 9999, contrast: 'x', lang: 'xx' }))
    expect(getA11y()).toMatchObject({ size: 100, contrast: 'normal', lang: 'en-ZA' })
  })
})

describe('voice commands', () => {
  it('maps spoken commands', () => {
    expect(commandOf('Send.')).toBe('send'); expect(commandOf('send message')).toBe('send')
    expect(commandOf('Clear')).toBe('clear'); expect(commandOf('stop listening')).toBe('stop')
  })
  it('never treats normal sentences as commands', () => {
    expect(commandOf('please send the report to john')).toBeNull()
    expect(commandOf('I will clear my schedule')).toBeNull()
  })
})
