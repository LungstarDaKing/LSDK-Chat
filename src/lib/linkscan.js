// Link inspector for "Watch together". Every address is checked BEFORE a page is opened in the player, on both phones.
// Verdicts:  'blocked' = never opened;  'warn' = opened only if the person confirms;  'safe' = no red flags found.
// IMPORTANT: this is a set of red-flag checks, not a guarantee. No scanner catches everything. A "safe" verdict means
// "nothing suspicious was found", and a deep check (Google Safe Browsing, through the link-scan function) is added when it is set up.

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 's.id', 'lnkd.in', 'v.gd', 'bl.ink', 'soo.gd', 'tr.im', 'qr.ae', 'adf.ly', 'bc.vc', 'ouo.io', 'shorte.st', 'clck.ru', 'urlz.fr', 'cli.re', 'vm.tiktok.com', 'vt.tiktok.com', 'fb.me', 'amzn.to', 'wa.me'])
const BAD_EXT = /\.(exe|msi|apk|xapk|ipa|bat|cmd|com|scr|pif|js|jse|jar|vbs|vbe|wsf|ps1|psm1|reg|lnk|hta|dll|sys|sh|bash|run|bin|appimage|dmg|pkg|deb|rpm|iso|img|vhd|zip|rar|7z|tar|gz|tgz|cab|docm|xlsm|pptm|dotm|swf|crx|xpi)$/i
const RISKY_TLDS = new Set(['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'click', 'country', 'kim', 'work', 'men', 'loan', 'download', 'review', 'stream', 'racing', 'gdn', 'bid', 'trade', 'date', 'party', 'science', 'cyou', 'icu', 'buzz', 'rest', 'monster', 'cam'])
const BLOCK_TLDS = new Set(['zip', 'mov'])      // look like file names
const LURE_WORDS = /(^|[\/_.\-?=&])(login|log-in|signin|sign-in|verify|verification|account-update|update-account|password|passcode|wallet|airdrop|giveaway|claim|free-?(robux|vbucks|gift)|crypto-?(bonus|giveaway)|seed-?phrase|security-?alert|unlock|suspend(ed)?)([\/_.\-?=&]|$)/i
const BRANDS = {
  paypal: ['paypal.com'], google: ['google.com', 'google.co.za', 'youtube.com', 'gstatic.com', 'googleusercontent.com'], apple: ['apple.com', 'icloud.com'], microsoft: ['microsoft.com', 'live.com', 'office.com', 'outlook.com', 'microsoftonline.com'],
  facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'], whatsapp: ['whatsapp.com', 'whatsapp.net'], netflix: ['netflix.com'], amazon: ['amazon.com', 'amazon.co.za', 'amazonaws.com'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], telegram: ['telegram.org', 't.me'], tiktok: ['tiktok.com', 'tiktokcdn.com'], spotify: ['spotify.com', 'scdn.co'], snapchat: ['snapchat.com'], steam: ['steampowered.com', 'steamcommunity.com'],
  capitec: ['capitecbank.co.za'], absa: ['absa.co.za', 'absa.africa'], nedbank: ['nedbank.co.za'], fnb: ['fnb.co.za'], standardbank: ['standardbank.co.za', 'standardbank.com'], sassa: ['sassa.gov.za'], sars: ['sars.gov.za'],
}
// the hand-kept list of hosts that must never open (add your own here when you hear of a bad one)
export const BLOCKED_HOSTS = new Set([])

const reason = (level, code, text) => ({ level, code, text })

// An IPv4 address written in a trick way (decimal 3232235777, hex 0xC0A80001, octal, short forms)
const looksNumericHost = (h) => /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(h)

// the part of the host people think of as "the site" (a small rule that covers the common cases, including co.za style endings)
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ne', 'or'])
export function registrable(host) {
  const p = host.split('.')
  if (p.length <= 2) return host
  return SECOND_LEVEL.has(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3).join('.') : p.slice(-2).join('.')
}

/** Inspect an address. Never throws. Returns { verdict, url, host, reasons[] }. */
export function scanLink(input) {
  const reasons = []
  const out = (verdict, url = '', host = '') => ({ verdict, url, host, reasons, ok: verdict !== 'blocked' })
  const raw = String(input ?? '').trim()
  if (!raw) { reasons.push(reason('block', 'empty', 'Paste a link first.')); return out('blocked') }
  if (raw.length > 400) { reasons.push(reason('block', 'long', 'That link is too long (400 characters at most).')); return out('blocked') }
  if (/[\s\u0000-\u001f\u007f<>"'`\\^{}|]/.test(raw)) { reasons.push(reason('block', 'chars', 'The link has spaces or unsafe characters.')); return out('blocked') }
  let u
  try { u = new URL(raw) } catch { reasons.push(reason('block', 'parse', 'That is not a valid link. It must start with https://')); return out('blocked') }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (u.protocol !== 'https:') { reasons.push(reason('block', 'scheme', u.protocol === 'http:' ? 'The link is not encrypted (http). Only https:// links can be opened.' : `Links of type "${u.protocol}" cannot be opened.`)); return out('blocked', '', host) }
  if (u.username || u.password) reasons.push(reason('block', 'creds', 'The link hides its real destination behind a user name (the part before an @). This is a common trick.'))
  if (u.port && u.port !== '443') reasons.push(reason('block', 'port', `The link uses an unusual port (${u.port}).`))
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(registrable(host))) reasons.push(reason('block', 'listed', 'This website is on the block list.'))
  if (host.startsWith('[') || /^[0-9a-f:]+$/i.test(host) && host.includes(':')) reasons.push(reason('block', 'ip', 'The link points straight at a number (an IP address), not a website name.'))
  else if (looksNumericHost(host)) reasons.push(reason('block', 'ip', 'The link points straight at a number (an IP address), not a website name.'))
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|test|invalid|example)$/.test(host)) reasons.push(reason('block', 'local', 'That address belongs to a private network, not the public internet.'))
  if (host.split('.').some((l) => l.startsWith('xn--')) || /[^\x00-\x7f]/.test(host)) reasons.push(reason('block', 'lookalike', 'The website name uses look-alike letters (it may be imitating another site).'))
  if (/[^a-z0-9.-]/.test(host)) reasons.push(reason('block', 'hostchars', 'The website name has unusual characters.'))
  if (SHORTENERS.has(host) || SHORTENERS.has(registrable(host))) reasons.push(reason('block', 'shortener', 'Short links hide where they go. Open the real page, copy its full address, and paste that.'))
  const tld = host.split('.').pop()
  if (BLOCK_TLDS.has(tld)) reasons.push(reason('block', 'tld', `Addresses ending in .${tld} are often disguised file names.`))
  else if (RISKY_TLDS.has(tld)) reasons.push(reason('warn', 'tld-risky', `Addresses ending in .${tld} are used a lot for scams.`))
  const path = decodeURIComponentSafe(u.pathname)
  const full = decodeURIComponentSafe(u.pathname + u.search)
  if (BAD_EXT.test(path.replace(/\/+$/, ''))) reasons.push(reason('block', 'download', 'This link is a file download, not a page to watch.'))
  if (/(javascript|data|vbscript|file|blob):/i.test(full) || /<\s*script|onerror\s*=|onload\s*=/i.test(full)) reasons.push(reason('block', 'script', 'The link contains script code.'))
  if (u.hash && /(javascript|data):/i.test(decodeURIComponentSafe(u.hash))) reasons.push(reason('block', 'script', 'The link contains script code.'))
  // pretending to be a well-known site
  const reg = registrable(host)
  for (const [brand, real] of Object.entries(BRANDS)) {
    const sub = host.slice(0, Math.max(0, host.length - reg.length))
    if ((reg.replace(/\..*$/, '').includes(brand) || sub.includes(brand)) && !real.some((d) => host === d || host.endsWith('.' + d))) {
      reasons.push(reason('block', 'impersonation', `The website name uses "${brand}" but it is not ${brand}'s real site.`)); break
    }
  }
  // softer signals
  const labels = host.split('.')
  if (labels.length > 5) reasons.push(reason('warn', 'deep', 'The website name has many parts, which is unusual.'))
  if ((host.match(/-/g) || []).length >= 4) reasons.push(reason('warn', 'hyphens', 'The website name has many dashes, which is unusual.'))
  if (/\d{5,}/.test(labels.slice(0, -2).join('.')) && labels.length > 2) reasons.push(reason('warn', 'digits', 'The website name contains a long number.'))
  if (LURE_WORDS.test(full)) reasons.push(reason('warn', 'lure', 'The address mentions logging in, verifying, or free prizes, which scammers use.'))
  for (const [k, v] of u.searchParams) if (/^(url|redirect|redirect_uri|return|returnto|next|goto|link|dest|destination|continue|target)$/i.test(k) && /^(https?:)?\/\//i.test(v)) { reasons.push(reason('warn', 'redirect', 'The link sends you on to another website.')); break }
  if (u.search.length > 300) reasons.push(reason('warn', 'query', 'The link has a very long tracking part.'))
  const blocked = reasons.some((r) => r.level === 'block')
  const warn = reasons.some((r) => r.level === 'warn')
  const clean = u.protocol + '//' + u.host + u.pathname + u.search     // no #fragment: it is never needed and can carry tricks
  return out(blocked ? 'blocked' : warn ? 'warn' : 'safe', blocked ? '' : clean, host)
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s) } catch { return s } }

/** Plain-language summary to show a person. */
export const summarize = (scan) => scan.reasons.map((r) => r.text).join(' ')

/** Deep check through the link-scan function (Google Safe Browsing). Returns { checked, threat }; never throws.
 *  When the function is not set up, `checked` is false and only the local checks above applied. */
export async function deepScan(supabase, url) {
  try {
    const { data, error } = await supabase.functions.invoke('link-scan', { body: { url } })
    if (error || !data || typeof data !== 'object') return { checked: false, threat: null }
    return { checked: !!data.checked, threat: typeof data.threat === 'string' ? data.threat : null }
  } catch { return { checked: false, threat: null } }
}
