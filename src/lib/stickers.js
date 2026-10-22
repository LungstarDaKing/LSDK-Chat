// Stickers: search (KLIPY, through your LUNEX server so the key stays secret), recents, favourites,
// and "My stickers" you make yourself. A KLIPY sticker is sent as a normal message whose text is
//   [sticker]https://static.klipy.com/....webp
// so no database change is needed. Only https links on klipy.com are ever shown.
import { supabase } from './supabase.js'
import { CONFIG } from '../config.js'

export const PREFIX = '[sticker]'
export const isStickerPreview = (c) => typeof c === 'string' && c.startsWith(PREFIX)
export function safeStickerUrl(u) {
  try {
    const x = new URL(String(u))
    const host = x.hostname.toLowerCase()
    return x.protocol === 'https:' && (host === 'klipy.com' || host.endsWith('.klipy.com')) && !x.username && !x.password && String(u).length <= 600 ? x.href : null
  } catch { return null }
}
export const stickerContent = (url) => PREFIX + url
export const stickerUrl = (content) => (isStickerPreview(content) ? safeStickerUrl(content.slice(PREFIX.length).trim()) : null)
export const isStickerFile = (m) => m?.attachment_name === 'sticker.webp' && m?.attachment_type === 'image/webp'
export const isStickerMsg = (m) => !!stickerUrl(m?.content) || isStickerFile(m)

/* ---------- search (via LUNEX) ---------- */
export class StickerApi {
  get base() { return (CONFIG.lunexUrl || '').replace(/\/$/, '') }
  get enabled() { return !!this.base }
  wake() { try { fetch(`${this.base}/health`, { cache: 'no-store' }).catch(() => {}) } catch { /* ignore */ } }
  async #get(path, params) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) throw new Error('Please sign in again to use stickers.')
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000)       // a sleeping free server can take a while
    try {
      const res = await fetch(`${this.base}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal })
      if (!res.ok) {
        let msg = 'Stickers are unavailable right now.'
        try { const j = await res.json(); if (typeof j.detail === 'string') msg = j.detail } catch { /* keep default */ }
        throw new Error(msg)
      }
      const j = await res.json()
      const items = (j.items || []).map((i) => ({ id: String(i.id), title: String(i.title || 'Sticker').slice(0, 80), url: safeStickerUrl(i.url), preview: safeStickerUrl(i.preview) || safeStickerUrl(i.url) }))
        .filter((i) => i.url && i.preview)
      return { items, hasNext: !!j.has_next }
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Stickers took too long to load. Try again.')
      if (e instanceof TypeError) throw new Error('Could not reach the sticker service. Check your connection.')
      throw e
    } finally { clearTimeout(t) }
  }
  trending(page = 1) { return this.#get('/v1/stickers/trending', { page }) }
  search(q, page = 1) { return this.#get('/v1/stickers/search', { q, page }) }
}

/* ---------- recents & favourites (this device, removed at sign-out) ---------- */
export function listStore(name, userId, max) {
  const key = `lsdk.stk.${name}.${userId}`
  const load = () => { try { const a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a.filter((i) => safeStickerUrl(i?.url)).slice(0, max) : [] } catch { return [] } }
  const save = (a) => { try { localStorage.setItem(key, JSON.stringify(a.slice(0, max))) } catch { /* full or blocked */ } }
  return {
    load,
    has: (url) => load().some((i) => i.url === url),
    add(item) { const a = load().filter((i) => i.url !== item.url); a.unshift({ id: item.id, title: item.title, url: item.url, preview: item.preview }); save(a) },
    remove(url) { save(load().filter((i) => i.url !== url)) },
  }
}
let wired = false
export function wireSignOutWipe() {
  if (wired) return; wired = true
  try { supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') try { for (const k of Object.keys(localStorage)) if (k.startsWith('lsdk.stk.')) localStorage.removeItem(k) } catch { /* ignore */ } }) } catch { /* ignore */ }
}

/* ---------- My stickers (made on this device, kept in the browser's own database) ---------- */
const MAX_MINE = 60
let memory = []
const idb = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('no idb'))
  const r = indexedDB.open('lsdk-stickers', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('mine', { keyPath: 'id' })
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
})
const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('mine', mode); const out = fn(t.objectStore('mine')); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error) }) }
export async function mineList(userId) {
  try { const all = await tx('readonly', (s) => s.getAll()); return all.filter((x) => x.owner === userId).sort((a, b) => b.created - a.created) }
  catch { return memory.filter((x) => x.owner === userId).sort((a, b) => b.created - a.created) }
}
export async function mineAdd(userId, blob) {
  const item = { id: crypto.randomUUID(), owner: userId, blob, created: Date.now() }
  const have = await mineList(userId)
  try { await tx('readwrite', (s) => { s.put(item); for (const old of have.slice(MAX_MINE - 1)) s.delete(old.id) }) } catch { memory = [item, ...memory].slice(0, MAX_MINE) }
  return item
}
export async function mineRemove(id) { try { await tx('readwrite', (s) => s.delete(id)) } catch { memory = memory.filter((x) => x.id !== id) } }
