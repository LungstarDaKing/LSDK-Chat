// Files: validation, upload, temporary links, avatars. Everything is checked here for
// friendliness AND again by the database / storage rules (the real protection).
import { supabase } from './supabase.js'

export const MAX_BYTES = 20 * 1024 * 1024
export const AVATAR_PX = 256

// MIME type -> file extension used in storage. Anything not listed is refused.
export const TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba', 'audio/aac': 'aac',
  'application/pdf': 'pdf', 'text/plain': 'txt',
}
// Some browsers report '' or odd types for a few formats; map by extension, then re-check.
const BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac', weba: 'audio/webm',
  pdf: 'application/pdf', txt: 'text/plain',
}
const ALIASES = { 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'video/x-m4v': 'video/mp4' }
export const ACCEPT = Object.keys(TYPES).join(',')
export const kind = (type) => (type || '').split('/')[0] === 'application' || type === 'text/plain' ? 'file' : (type || '').split('/')[0]

export function resolveType(file) {
  let t = (file.type || '').toLowerCase().split(';')[0].trim()
  t = ALIASES[t] || t
  if (TYPES[t]) return t
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if ((!t || t === 'application/octet-stream') && BY_EXT[ext]) return BY_EXT[ext]
  return null
}

export function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

// Strip any path, control characters and odd whitespace from a display name.
export function cleanName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim()
  return (base || 'file').slice(0, 120)
}

// Compare the first bytes with what the type claims (cheap defence against mislabelled files).
async function sniffOk(file, type) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const s = (from, str) => [...str].every((c, i) => b[from + i] === c.charCodeAt(0))
  switch (type) {
    case 'application/pdf': return s(0, '%PDF')
    case 'video/mp4': case 'video/quicktime': case 'audio/mp4': return s(4, 'ftyp')
    case 'video/webm': case 'audio/webm': return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
    case 'audio/ogg': return s(0, 'OggS')
    case 'audio/wav': return s(0, 'RIFF') && s(8, 'WAVE')
    case 'audio/mpeg': return s(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
    case 'audio/aac': return (b[0] === 0xff && (b[1] & 0xf0) === 0xf0) || s(0, 'ADIF')
    case 'text/plain': return !b.includes(0)
    default: return true        // images are verified by decoding them (see cleanImage)
  }
}

// Photos can carry GPS location and device details. Re-drawing the picture through a canvas
// drops all of that. GIFs are left alone (re-drawing would remove the animation).
async function cleanImage(file, type) {
  if (type === 'image/gif') {
    const b = new Uint8Array(await file.slice(0, 6).arrayBuffer())
    if (String.fromCharCode(...b).slice(0, 3) !== 'GIF') throw new Error('That file is not a valid GIF.')
    return file
  }
  let bmp
  try { bmp = await createImageBitmap(file) } catch { throw new Error('That image could not be read. Try another file.') }
  if (bmp.width * bmp.height > 80e6) { bmp.close?.(); throw new Error('That image is too large (over 80 megapixels).') }
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width; canvas.height = bmp.height
  canvas.getContext('2d').drawImage(bmp, 0, 0)
  bmp.close?.()
  const blob = await new Promise((res) => canvas.toBlob(res, type, 0.92))
  if (!blob) throw new Error('That image could not be processed.')
  return blob
}

export async function prepareFile(file) {
  if (!file || !file.size) throw new Error('That file is empty.')
  if (file.size > MAX_BYTES) throw new Error(`Files are limited to ${fmtSize(MAX_BYTES)}.`)
  const type = resolveType(file)
  if (!type) throw new Error('That file type is not allowed. You can send photos, videos, audio, PDFs and text files.')
  if (!(await sniffOk(file, type))) throw new Error('The file content does not match its type, so it was not sent.')
  const body = type.startsWith('image/') ? await cleanImage(file, type) : file
  if (body.size > MAX_BYTES) throw new Error(`Files are limited to ${fmtSize(MAX_BYTES)}.`)
  return { body, type, name: cleanName(file.name), size: body.size }
}

export async function uploadAttachment(roomId, userId, file) {
  const p = await prepareFile(file)
  const path = `${roomId}/${userId}/${crypto.randomUUID()}.${TYPES[p.type]}`
  const { error } = await supabase.storage.from('media').upload(path, p.body, { contentType: p.type, upsert: false, cacheControl: '3600' })
  if (error) throw error
  return { path, name: p.name, type: p.type, size: p.size }
}

/* ---------- temporary links (signed URLs) ---------- */
const cache = new Map()            // `${bucket}:${path}` -> { url, exp }
const TTL = 3600                    // seconds a link stays valid (1 hour)
export async function signedUrls(bucket, paths, download) {
  const now = Date.now()
  const out = new Map()
  const need = []
  for (const p of new Set(paths.filter(Boolean))) {
    const hit = !download && cache.get(`${bucket}:${p}`)
    if (hit && hit.exp > now + 60000) out.set(p, hit.url)
    else need.push(p)
  }
  if (need.length && !download) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(need, TTL)
    for (const row of data || []) if (row.signedUrl && !row.error) {
      cache.set(`${bucket}:${row.path}`, { url: row.signedUrl, exp: now + TTL * 1000 })
      out.set(row.path, row.signedUrl)
    }
  } else if (need.length) {
    for (const p of need) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(p, 600, { download })
      if (data?.signedUrl) out.set(p, data.signedUrl)
    }
  }
  return out
}
export const signedUrl = async (bucket, path, download) => (await signedUrls(bucket, [path], download)).get(path) || null

export async function removeFiles(bucket, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100))
    if (error) throw error
  }
  paths.forEach((p) => cache.delete(`${bucket}:${p}`))
}

// Every file under a folder, going `depth` sub-folders down (used when a room or an account is deleted).
export async function listFiles(bucket, prefix, depth = 0) {
  const found = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100, offset })
    if (error) throw error
    for (const f of data) {
      if (f.id) found.push(`${prefix}/${f.name}`)
      else if (depth > 0) found.push(...(await listFiles(bucket, `${prefix}/${f.name}`, depth - 1)))
    }
    if (data.length < 100) break
  }
  return found
}

/* ---------- avatars ---------- */
export async function makeAvatarBlob(file) {
  const type = resolveType(file)
  if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Choose a JPG, PNG or WebP picture.')
  if (file.size > 15 * 1024 * 1024) throw new Error('That picture is too large (max 15 MB).')
  let bmp
  try { bmp = await createImageBitmap(file) } catch { throw new Error('That picture could not be read.') }
  const side = Math.min(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX)
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  bmp.close?.()
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
  if (!blob) throw new Error('That picture could not be processed.')
  return blob
}

export async function setAvatar(userId, file) {
  const blob = await makeAvatarBlob(file)
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  const { error: e2 } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId)
  if (e2) { await supabase.storage.from('avatars').remove([path]); throw e2 }
  return path
}

// Remove all of a user's avatar files except `keep`.
export async function pruneAvatars(userId, keep = null) {
  const all = await listFiles('avatars', userId)
  const old = all.filter((p) => p !== keep)
  if (old.length) await removeFiles('avatars', old)
}
