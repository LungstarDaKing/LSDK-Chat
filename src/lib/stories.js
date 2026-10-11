// Status updates ("stories"): text, photo, video or audio that disappear after 24 hours.
// Who can see them is decided by the database (story_visible), not by this file.
import { supabase } from './supabase.js'
import { removeFiles, uploadStoryMedia, signedUrl } from './media.js'

export const TEXT_BGS = [
  'linear-gradient(135deg,#4f46e5,#9333ea)', 'linear-gradient(135deg,#0ea5e9,#2563eb)',
  'linear-gradient(135deg,#10b981,#047857)', 'linear-gradient(135deg,#f59e0b,#dc2626)',
  'linear-gradient(135deg,#ec4899,#be185d)', 'linear-gradient(135deg,#14b8a6,#0e7490)',
  'linear-gradient(135deg,#64748b,#1e293b)', 'linear-gradient(135deg,#a855f7,#4338ca)',
]
const COLS = 'id, author_id, kind, content, bg, attachment_path, attachment_name, attachment_type, attachment_size, created_at, expires_at'

// -> { groups: [{ authorId, stories: [...], unseen: boolean }] } mine first, then people with unseen stories first
export async function loadStories(meId) {
  const { data, error } = await supabase.from('stories').select(COLS)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true }).limit(500)
  if (error) throw error
  const ids = (data || []).map((s) => s.id)
  const seen = new Set()
  if (ids.length) {
    const { data: v } = await supabase.from('story_views').select('story_id').in('story_id', ids)
    for (const r of v || []) seen.add(r.story_id)
  }
  const by = new Map()
  for (const s of data || []) {
    if (!by.has(s.author_id)) by.set(s.author_id, [])
    by.get(s.author_id).push({ ...s, seen: s.author_id === meId || seen.has(s.id) })
  }
  const groups = [...by.entries()].map(([authorId, stories]) => ({
    authorId, stories, unseen: stories.some((s) => !s.seen), latest: stories[stories.length - 1].created_at,
  }))
  groups.sort((a, b) => (a.authorId === meId ? -1 : b.authorId === meId ? 1 : (b.unseen - a.unseen) || (new Date(b.latest) - new Date(a.latest))))
  return groups
}

export async function postTextStory(meId, content, bg) {
  const { error } = await supabase.from('stories').insert({ author_id: meId, kind: 'text', content: content.trim(), bg })
  if (error) throw error
}

export async function postMediaStory(meId, file, caption) {
  const up = await uploadStoryMedia(meId, file)
  const { error } = await supabase.from('stories').insert({
    author_id: meId, kind: up.type.split('/')[0], content: (caption || '').trim().slice(0, 300),
    attachment_path: up.path, attachment_name: up.name, attachment_type: up.type, attachment_size: up.size,
  })
  if (error) { removeFiles('stories', [up.path]).catch(() => {}); throw error }
}

export const markViewed = (id) => supabase.rpc('mark_story_viewed', { p_story: id }).then(() => {}, () => {})
export const reportStory = (id, reason) => supabase.rpc('report_story', { p_story: id, p_reason: reason })
export async function getViewers(id) {
  const { data, error } = await supabase.rpc('get_story_viewers', { p_story: id })
  if (error) throw error
  return data || []
}

export async function deleteStory(s) {
  if (s.attachment_path) await removeFiles('stories', [s.attachment_path])
  const { error } = await supabase.from('stories').delete().eq('id', s.id)
  if (error) throw error
}

// Expired files are only removed when their author opens the app (no server job on the free plan).
export async function sweepMyStories(meId) {
  try {
    const { data } = await supabase.from('stories').select('id, attachment_path, expires_at').eq('author_id', meId).lte('expires_at', new Date().toISOString()).limit(100)
    if (!data?.length) return
    const files = data.map((s) => s.attachment_path).filter(Boolean)
    if (files.length) await removeFiles('stories', files)
    await supabase.from('stories').delete().in('id', data.map((s) => s.id))
  } catch { /* try again next time */ }
}

/* ---------- likes, comments, saving ---------- */
export async function getMyLike(storyId, meId) {
  const { data } = await supabase.from('story_likes').select('story_id').eq('story_id', storyId).eq('user_id', meId).maybeSingle()
  return !!data
}
export async function setLike(storyId, on) {
  const { error } = await supabase.rpc('like_story', { p_story: storyId, p_on: on })
  if (error) throw error
}
export async function sendComment(storyId, text) {
  const { error } = await supabase.rpc('comment_on_story', { p_story: storyId, p_content: text })
  if (error) throw error
}
// Author only -> [{ kind: 'like'|'comment', id, user_id, username, content, created_at }]
export async function getActivity(storyId) {
  const { data, error } = await supabase.rpc('get_story_activity', { p_story: storyId })
  if (error) throw error
  return data || []
}
export const deleteComment = (id) => supabase.from('story_comments').delete().eq('id', id)
export const reportComment = (id, reason) => supabase.rpc('report_story_comment', { p_comment: id, p_reason: reason })

// Opens the browser's download for a story photo / video / audio file.
export async function saveStoryMedia(s) {
  const url = await signedUrl('stories', s.attachment_path, s.attachment_name)
  if (!url) throw new Error('Could not open this file.')
  const a = document.createElement('a'); a.href = url; a.rel = 'noopener noreferrer'; a.download = s.attachment_name
  document.body.append(a); a.click(); a.remove()
}

// How many new likes / comments arrived on my statuses since I last opened the Status tab.
const K_SEEN = 'lsdkchat.statusSeen'
export const markStatusSeen = () => { try { localStorage.setItem(K_SEEN, new Date().toISOString()) } catch { /* ignore */ } }
export async function newActivityCount(meId) {
  let since = '1970-01-01'
  try { since = localStorage.getItem(K_SEEN) || since } catch { /* ignore */ }
  const q = (t) => supabase.from(t).select('story_id', { count: 'exact', head: true }).eq('author_id', meId).gt('created_at', since)
  const [a, b] = await Promise.all([q('story_likes'), q('story_comments')])
  return (a.count || 0) + (b.count || 0)
}
