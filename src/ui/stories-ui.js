import { icon } from './icons.js'
import { editImage } from './image-editor.js'
import { h, clear, toast, dialog, confirmDialog, friendlyError } from '../lib/dom.js'
import { loadStories, postTextStory, postMediaStory, markViewed, reportStory, getViewers, deleteStory, TEXT_BGS, getMyLike, setLike, sendComment, getActivity, deleteComment, reportComment, saveStoryMedia } from '../lib/stories.js'
import { STORY_ACCEPT, signedUrl, fmtSize } from '../lib/media.js'

const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

// ctx = the Chat object (people, avatar(), hydrateAvatars(), ensurePeople(), nameOf(), me)
export async function renderUpdates(box, ctx) {
  clear(box).append(h('p', { class: 'hint pad' }, 'Loading…'))
  let groups
  try { groups = await loadStories(ctx.me.id) } catch (e) { return clear(box).append(h('p', { class: 'hint pad' }, friendlyError(e))) }
  await ctx.ensurePeople(groups.map((g) => g.authorId))
  clear(box)
  const mine = groups.find((g) => g.authorId === ctx.me.id)
  const others = groups.filter((g) => g.authorId !== ctx.me.id)

  const open = (list, i = 0) => openViewer(list, i, ctx, () => renderUpdates(box, ctx))
  box.append(h('div', { class: 'list-title' }, 'My status'),
    h('div', { class: 'row-item' },
      h('button', { class: 'row-main', type: 'button', onclick: () => (mine ? open([mine]) : openComposer(ctx, () => renderUpdates(box, ctx))) },
        h('span', { class: `ring${mine ? ' mine' : ' none'}` }, ctx.avatar(ctx.me.id, 'md')),
        h('span', { class: 'row-meta' }, h('span', { class: 'row-name' }, 'My status'),
          h('span', { class: 'row-sub' }, mine ? `${mine.stories.length} update${mine.stories.length > 1 ? 's' : ''} · ${ago(mine.latest)}` : 'Tap to add a status update'))),
      h('button', { class: 'btn icon round primary', type: 'button', title: 'Add status', 'aria-label': 'Add status update', onclick: () => openComposer(ctx, () => renderUpdates(box, ctx)) }, '+')))
  box.append(h('div', { class: 'list-title' }, 'Recent updates'))
  if (!others.length) box.append(h('p', { class: 'hint pad' }, 'No updates from your contacts right now. Updates disappear after 24 hours.'))
  others.forEach((g, idx) => box.append(h('div', { class: 'row-item' },
    h('button', { class: 'row-main', type: 'button', onclick: () => open(others, idx) },
      h('span', { class: `ring${g.unseen ? '' : ' seen'}` }, ctx.avatar(g.authorId, 'md')),
      h('span', { class: 'row-meta' }, h('span', { class: 'row-name' }, ctx.nameOf(g.authorId)), h('span', { class: 'row-sub' }, ago(g.latest)))))))
  ctx.hydrateAvatars(box)
}

export function openComposer(ctx, done) {
  let bg = 0
  const text = h('textarea', { rows: 5, maxLength: 300, placeholder: 'Type a status', 'aria-label': 'Status text' })
  const stage = h('div', { class: 'story-stage' }, text)
  const paint = () => { stage.style.background = TEXT_BGS[bg] }
  paint()
  const swatches = h('div', { class: 'swatches' }, TEXT_BGS.map((c, i) => {
    const b = h('button', { type: 'button', class: 'swatch', 'aria-label': `Colour ${i + 1}`, onclick: () => { bg = i; paint() } })
    b.style.background = c
    return b
  }))
  const file = h('input', { type: 'file', accept: STORY_ACCEPT, hidden: true, 'aria-label': 'Choose a photo, video or audio file',
    onchange: () => { const f = file.files[0]; file.value = ''; if (f) { d.close(); mediaComposer(ctx, f, done) } } })
  const err = h('div', { class: 'msg error', role: 'alert' })
  const d = dialog({
    title: 'New status',
    body: [stage, swatches, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, '📷 Photo, video or music instead'), file,
      h('p', { class: 'small' }, 'Visible for 24 hours to people you share a chat with (you can switch this off in Settings). Up to 20 updates a day.'), err],
    actions: [{ label: 'Cancel' }, { label: 'Post', kind: 'primary', onClick: async () => {
      if (!text.value.trim()) { err.textContent = 'Write something first.'; return 'keep-open' }
      try { await postTextStory(ctx.me.id, text.value, bg); toast('Status posted', 'success'); done?.() }
      catch (e) { err.textContent = friendlyError(e); return 'keep-open' }
    } }],
  })
  text.focus()
}

function mediaComposer(ctx, original, done) {
  let file = original
  const caption = h('input', { type: 'text', maxLength: 300, placeholder: 'Add a caption (optional)', 'aria-label': 'Caption' })
  const err = h('div', { class: 'msg error', role: 'alert' })
  let preview = null
  const info = h('p', {}, h('strong', {}, file.name.slice(0, 80)), ` · ${fmtSize(file.size)}`)
  const show = () => {
    const url = URL.createObjectURL(file)
    preview.addEventListener('load', () => URL.revokeObjectURL(url), { once: true })
    preview.src = url
    info.replaceChildren(h('strong', {}, file.name.slice(0, 80)), ` · ${fmtSize(file.size)}`)
  }
  const editBtn = file.type.startsWith('image/') && /^image\/(jpeg|png|webp)$/.test(file.type) ? h('button', { class: 'btn', type: 'button', onclick: async () => {
    const edited = await editImage(file, { title: 'Edit status photo', aspect: 'status', aspects: ['status', 'portrait', 'square', 'wide'] })
    if (edited) { file = edited; show() }
  } }, icon('sliders', 16), ' Crop and filters') : null
  if (file.type.startsWith('image/')) { preview = h('img', { class: 'preview', alt: 'Preview' }); show() }
  dialog({
    title: 'Post this status?',
    body: [preview, editBtn, info, caption, err],
    actions: [{ label: 'Cancel' }, { label: 'Post', kind: 'primary', onClick: async () => {
      try { toast('Uploading…'); await postMediaStory(ctx.me.id, file, caption.value); toast('Status posted', 'success'); done?.() }
      catch (e) { err.textContent = friendlyError(e); return 'keep-open' }
    } }],
  })
}

/* ---------- full-screen viewer ---------- */
function openViewer(list, startGroup, ctx, onClose) {
  let gi = startGroup, si = 0, timer = null, paused = false, remaining = 5000, started = 0, media = null
  const prev = document.activeElement
  const bars = h('div', { class: 'story-bars' })
  const head = h('div', { class: 'story-head' })
  const body = h('div', { class: 'story-body' })
  const foot = h('div', { class: 'story-foot' })
  const ov = h('div', { class: 'story-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Status viewer', tabIndex: -1 },
    bars, head, body, foot,
    h('button', { class: 'story-nav left', type: 'button', 'aria-label': 'Previous', onclick: () => step(-1) }),
    h('button', { class: 'story-nav right', type: 'button', 'aria-label': 'Next', onclick: () => step(1) }))
  const close = () => {
    clearTimeout(timer); media?.pause?.(); document.removeEventListener('keydown', onKey); ov.remove(); prev?.focus?.(); onClose?.()
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1) }
  document.addEventListener('keydown', onKey)

  const group = () => list[gi]
  const cur = () => group().stories[si]
  function step(dir) {
    clearTimeout(timer)
    si += dir
    if (si < 0) { gi = Math.max(0, gi - 1); si = 0 }
    else if (si >= group().stories.length) { gi += 1; si = 0 }
    if (gi >= list.length) return close()
    show()
  }
  function schedule(ms) {
    clearTimeout(timer); remaining = ms; started = performance.now()
    if (!paused) timer = setTimeout(() => step(1), ms)
    const fill = bars.children[si]?.firstChild
    if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth; fill.style.transition = `width ${ms}ms linear`; fill.style.width = '100%' }
  }

  async function show() {
    const g = group(), s = cur(), mine = g.authorId === ctx.me.id
    media = null
    clear(bars); g.stories.forEach((x, i) => { const f = h('i'); f.style.width = i < si ? '100%' : '0%'; bars.append(h('span', {}, f)) })
    clear(head).append(ctx.avatar(g.authorId, 'sm'), h('div', { class: 'story-who' }, h('strong', {}, mine ? 'You' : ctx.nameOf(g.authorId)), h('small', {}, ago(s.created_at))),
      h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x', 22)))
    ctx.hydrateAvatars(head)
    clear(body); body.style.background = ''
    clear(foot)
    if (s.kind === 'text') {
      body.style.background = TEXT_BGS[s.bg] || TEXT_BGS[0]
      body.append(h('p', { class: 'story-text' }, s.content))
      schedule(Math.min(9000, 4000 + s.content.length * 40))
    } else {
      body.style.background = '#000'
      body.append(h('p', { class: 'story-loading' }, 'Loading…'))
      const url = await signedUrl('stories', s.attachment_path)
      if (cur() !== s) return
      clear(body)
      if (!url) body.append(h('p', { class: 'story-loading' }, 'Could not load this status.')), schedule(3000)
      else if (s.kind === 'image') {
        body.append(h('img', { src: url, alt: s.content || 'Status photo', referrerPolicy: 'no-referrer' })); schedule(6000)
      } else {
        const el = h(s.kind === 'video' ? 'video' : 'audio', { src: url, autoplay: true, playsInline: true, controls: s.kind === 'audio' })
        media = el
        if (s.kind === 'audio') body.append(h('div', { class: 'story-music' }, '🎵'))
        body.append(el)
        el.addEventListener('loadedmetadata', () => schedule(Math.min(60000, Math.max(3000, (el.duration || 10) * 1000))), { once: true })
        el.addEventListener('error', () => { clearTimeout(timer); timer = setTimeout(() => step(1), 2500) })
        el.play?.().catch(() => {})
        schedule(15000)
      }
    }
    if (s.content && s.kind !== 'text') foot.append(h('p', { class: 'story-caption' }, s.content))
    if (mine) {
      const act = h('button', { class: 'btn small', type: 'button', onclick: () => activity(s) }, '♥ 💬 Activity')
      foot.append(h('div', { class: 'story-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => viewers(s) }, '👁 Viewers'), act,
        h('button', { class: 'btn small danger', type: 'button', onclick: () => remove(s) }, 'Delete')))
      getActivity(s.id).then((rows) => { if (cur() === s) act.textContent = `♥ ${rows.filter((r) => r.kind === 'like').length} · 💬 ${rows.filter((r) => r.kind === 'comment').length}` }, () => {})
    } else {
      markViewed(s.id)
      const like = h('button', { class: 'btn icon round like-btn', type: 'button', 'aria-label': 'Like', 'aria-pressed': 'false', title: 'Like' }, icon('heart', 20))
      let liked = false
      const paintLike = () => { like.replaceChildren(icon('heart', 20)); like.classList.toggle('liked', liked); like.setAttribute('aria-pressed', String(liked)); like.classList.toggle('on', liked) }
      getMyLike(s.id, ctx.me.id).then((v) => { if (cur() === s) { liked = v; paintLike() } })
      like.onclick = async () => {
        like.disabled = true
        try { await setLike(s.id, !liked); liked = !liked; paintLike() } catch (e) { toast(friendlyError(e), 'error') }
        like.disabled = false
      }
      const box = h('input', { class: 'story-comment', type: 'text', maxLength: 300, placeholder: 'Reply privately…', 'aria-label': 'Comment on this status', autocomplete: 'off' })
      const send = async () => {
        const v = box.value.trim(); if (!v) return
        box.disabled = true
        try { await sendComment(s.id, v); box.value = ''; toast('Sent to your chat with them.', 'success') } catch (e) { toast(friendlyError(e), 'error') }
        box.disabled = false; box.focus()
      }
      box.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); send() } })
      box.addEventListener('focus', hold); box.addEventListener('blur', () => { if (paused && ov.isConnected && !document.querySelector('dialog[open]')) unhold() })
      foot.append(h('div', { class: 'story-reply' }, box,
        h('button', { class: 'btn icon round', type: 'button', 'aria-label': 'Send comment', title: 'Send', onclick: send }, icon('send', 18)), like),
        h('div', { class: 'story-actions' },
          s.kind !== 'text' && h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await saveStoryMedia(s); toast('Saved to your downloads', 'success') } catch (e) { toast(friendlyError(e), 'error') } } }, icon('download', 16), ' Save'),
          h('button', { class: 'btn small', type: 'button', onclick: () => report(s) }, 'Report')))
    }
  }

  const hold = () => { paused = true; clearTimeout(timer); remaining -= performance.now() - started; media?.pause?.(); bars.classList.add('paused') }
  const unhold = () => { paused = false; bars.classList.remove('paused'); media?.play?.().catch(() => {}); schedule(Math.max(800, remaining)) }
  const pauseFor = async (fn) => { hold(); try { await fn() } finally { if (ov.isConnected) unhold() } }

  const viewers = (s) => pauseFor(async () => {
    let rows = []
    try { rows = await getViewers(s.id) } catch (e) { return toast(friendlyError(e), 'error') }
    await ctx.ensurePeople(rows.map((r) => r.viewer_id))
    await new Promise((res) => dialog({ title: `Seen by ${rows.length}`, onClose: res, actions: [{ label: 'Close' }],
      body: rows.length ? h('ul', { class: 'members' }, rows.map((r) => h('li', {}, h('span', {}, r.username), h('small', {}, ago(r.viewed_at))))) : h('p', {}, 'Nobody has seen this yet.') }))
  })
  const activity = (s) => pauseFor(async () => {
    let rows = []
    try { rows = await getActivity(s.id) } catch (e) { return toast(friendlyError(e), 'error') }
    const likes = rows.filter((r) => r.kind === 'like'), comments = rows.filter((r) => r.kind === 'comment')
    const body = h('div', {})
    const draw = () => {
      clear(body)
      body.append(h('h3', {}, `❤️ Likes (${likes.length})`), likes.length ? h('p', {}, likes.map((l) => l.username).join(', ')) : h('p', { class: 'small' }, 'No likes yet.'),
        h('h3', {}, `💬 Comments (${comments.length})`), h('p', { class: 'small' }, 'Comments also arrive in your chat with the person, where you can reply.'),
        comments.length ? h('ul', { class: 'members' }, comments.map((c) => h('li', { class: 'comment-li' },
          h('span', { class: 'grow' }, h('strong', {}, c.username), h('span', { class: 'block cm-text' }, c.content), h('small', {}, ago(c.created_at))),
          h('span', { class: 'row tight' },
            h('button', { class: 'linkish', type: 'button', onclick: async () => { const { error } = await deleteComment(c.id); if (error) return toast(friendlyError(error), 'error'); comments.splice(comments.indexOf(c), 1); draw() } }, 'Delete'),
            h('button', { class: 'linkish', type: 'button', onclick: () => reportC(c) }, 'Report'))))) : h('p', { class: 'small' }, 'No comments yet.'))
    }
    const reportC = (c) => {
      const reason = h('textarea', { rows: 3, maxLength: 500, 'aria-label': 'Reason', placeholder: 'What is wrong with this comment?' })
      const err = h('div', { class: 'msg error', role: 'alert' })
      dialog({ title: 'Report comment', body: [h('blockquote', {}, c.content.slice(0, 300)), reason, err],
        actions: [{ label: 'Cancel' }, { label: 'Send report', kind: 'primary', onClick: async () => {
          if (!reason.value.trim()) { err.textContent = 'Please describe the problem.'; return 'keep-open' }
          const { error } = await reportComment(c.id, reason.value.trim())
          if (error) { err.textContent = friendlyError(error); return 'keep-open' }
          toast('Report sent. Thank you.', 'success')
        } }] })
    }
    draw()
    await new Promise((res) => dialog({ title: 'Activity on your status', body, onClose: res, actions: [{ label: 'Close' }] }))
  })
  const remove = (s) => pauseFor(async () => {
    if (!(await confirmDialog('Delete this status?', 'It will disappear for everyone.', 'Delete', true))) return
    try { await deleteStory(s) } catch (e) { return toast(friendlyError(e), 'error') }
    group().stories.splice(si, 1)
    if (!group().stories.length) { list.splice(gi, 1); gi = Math.min(gi, list.length - 1) }
    si = Math.min(si, Math.max(0, (list[gi]?.stories.length || 1) - 1))
    if (!list.length) return close()
    show()
  })
  const report = (s) => pauseFor(async () => {
    const reason = h('textarea', { rows: 3, maxLength: 500, 'aria-label': 'Reason', placeholder: 'What is wrong with this status?' })
    const err = h('div', { class: 'msg error', role: 'alert' })
    await new Promise((res) => dialog({ title: 'Report status', onClose: res,
      body: [h('p', { class: 'small' }, 'The operator will receive this status (and its file) and your reason. The author is not told who reported it.'), reason, err],
      actions: [{ label: 'Cancel' }, { label: 'Send report', kind: 'primary', onClick: async () => {
        if (!reason.value.trim()) { err.textContent = 'Please describe the problem.'; return 'keep-open' }
        const { error } = await reportStory(s.id, reason.value.trim())
        if (error) { err.textContent = friendlyError(error); return 'keep-open' }
        toast('Report sent. Thank you.', 'success')
      } }] }))
  })

  ov.addEventListener('pointerdown', (e) => { if (e.target.closest('button, a, textarea, input, audio')) return; hold() })
  ov.addEventListener('pointerup', () => { if (paused && !document.querySelector('dialog[open]')) unhold() })
  ov.addEventListener('pointercancel', () => { if (paused && !document.querySelector('dialog[open]')) unhold() })
  document.body.append(ov)
  ov.focus()
  show()
}
