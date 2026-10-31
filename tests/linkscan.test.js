import { describe, it, expect } from 'vitest'
import { scanLink, registrable, deepScan, summarize } from '../src/lib/linkscan.js'

const v = (u) => scanLink(u).verdict
describe('link inspector: blocks', () => {
  it.each([
    ['http://example-videos.com/watch', 'not https'],
    ['javascript:alert(1)', 'js scheme'], ['data:text/html,<script>alert(1)</script>', 'data scheme'], ['file:///etc/passwd', 'file scheme'], ['ftp://files.example.com/a', 'ftp'],
    ['https://user:pass@videos.example-site.com/v', 'credentials'], ['https://google.com@evil-site.net/v', 'at-sign trick'],
    ['https://192.168.1.10/video', 'private IP'], ['https://8.8.8.8/x', 'public IP'], ['https://3232235777/x', 'decimal IP'], ['https://0xC0A80001/x', 'hex IP'], ['https://[::1]/x', 'ipv6 loopback'],
    ['https://localhost/x', 'localhost'], ['https://printer.local/x', '.local'], ['https://intranet/x', 'no dot'],
    ['https://xn--pypal-4ve.com/login', 'punycode'], ['https://раураl.com/x', 'cyrillic lookalike'],
    ['https://bit.ly/3abcde', 'shortener'], ['https://tinyurl.com/yabc', 'shortener'], ['https://vm.tiktok.com/ZMabc/', 'tiktok short'],
    ['https://cdn.example.com/setup.exe', 'exe'], ['https://cdn.example.com/app.apk', 'apk'], ['https://cdn.example.com/a.zip', 'zip'], ['https://cdn.example.com/x.dmg?dl=1', 'dmg'],
    ['https://paypal-secure-login.example.com/x', 'brand in subdomain'], ['https://my-paypal.net/x', 'brand lookalike'], ['https://capitec-verify.com/x', 'SA bank lookalike'],
    ['https://example.com:8443/x', 'odd port'], ['https://files.zip/x', '.zip tld'],
    ['https://site.example.net/p?x=<script>alert(1)</script>', 'script in query'], ['https://site.example.net/p?x=javascript:alert(1)', 'js in query'],
    ['https://example.com/a b', 'space'], ['', 'empty'], ['not a link', 'garbage'],
  ])('%s (%s)', (u) => { expect(v(u)).toBe('blocked') })
  it('blocks absurdly long links', () => { expect(v('https://example.net/' + 'a'.repeat(500))).toBe('blocked') })
})
describe('link inspector: allows normal links', () => {
  it.each([
    'https://vimeo.com/76979871', 'https://www.dailymotion.com/video/x7tgad0', 'https://www.twitch.tv/videos/12345', 'https://archive.org/details/night_of_the_living_dead',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.apple.com/us/album/x/12345', 'https://www.bbc.co.uk/iplayer/episode/p0abc', 'https://www.news24.com/video/x',
    'https://www.google.com/search?q=cats', 'https://accounts.google.com/signin', 'https://www.paypal.com/za/home', 'https://www.capitecbank.co.za/personal',
  ])('%s', (u) => { expect(v(u)).not.toBe('blocked') })
  it('drops the #fragment from the cleaned address', () => { expect(scanLink('https://vimeo.com/1#t=30s').url).toBe('https://vimeo.com/1') })
  it('marks plain pages safe', () => { expect(v('https://vimeo.com/76979871')).toBe('safe') })
})
describe('link inspector: warns', () => {
  it('risky endings and scam wording ask for confirmation', () => {
    expect(v('https://cool-videos.xyz/watch')).toBe('warn')
    expect(v('https://some-site.example.net/claim/free-gift')).toBe('warn')
    expect(v('https://redirector.example.net/go?url=https://elsewhere.example.org/')).toBe('warn')
  })
  it('explains in plain language', () => { expect(summarize(scanLink('https://bit.ly/x'))).toMatch(/Short links/) })
})
describe('registrable()', () => {
  it('handles co.za style endings', () => { expect(registrable('www.capitecbank.co.za')).toBe('capitecbank.co.za'); expect(registrable('a.b.example.com')).toBe('example.com') })
})
describe('deepScan', () => {
  const fake = (r) => ({ functions: { invoke: async () => r } })
  it('reports a threat', async () => { expect(await deepScan(fake({ data: { checked: true, threat: 'MALWARE' } }), 'https://x.example')).toEqual({ checked: true, threat: 'MALWARE' }) })
  it('degrades quietly when the function is missing', async () => {
    expect(await deepScan(fake({ error: new Error('404') }), 'u')).toEqual({ checked: false, threat: null })
    expect(await deepScan({ functions: { invoke: async () => { throw new Error('x') } } }, 'u')).toEqual({ checked: false, threat: null })
  })
})
