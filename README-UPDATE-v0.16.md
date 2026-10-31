# LSDKChat web update v0.16 — Watch together fixed + any link, Animation setting, ACCESS GRANTED

## Put it on your site
1. Copy everything in this zip over C:\Users\mthet\Downloads\LSDKChat (same folder names). Do NOT touch src\config.js — it is not in this zip.
2. Do NOT paste older copies of src\pages\chat.js (or any file) over these. That is what removed the Watch together button before. New tests now fail loudly if it happens again.
3. In that folder:  npm install   then   npm test   (all 130 should pass)
4. git add . ; git commit -m "v0.16 watch links, animation, access granted" ; git push
5. Wait for GitHub Actions to finish, then Ctrl+F5.

## Supabase (needed for watching links)
- SQL editor: run supabase/update-v0.16-watch-links.sql (after your earlier update-v0.xx files; it is safe to run twice).
- Optional deeper link check (Google Safe Browsing): 
    supabase functions deploy link-scan
    supabase secrets set GSB_API_KEY=your_key
  Without it, links still get the built-in checks on both phones; the app says "not a guarantee".

## What changed
- Watch together button is back in one-to-one chats. Works with YouTube, Spotify, Apple Music, TikTok, and now ANY https link.
- Every link is inspected on BOTH devices before it opens. Shorteners, raw IP addresses, look-alike/punycode names, credential-in-URL, javascript:/data: and similar are refused; mildly odd ones ask first. Pages open in a locked-down frame (no popups, no top navigation, no downloads).
- Login/sign-up: Settings > Animation: Auto / On / Still. "On" keeps moving even if Windows has "reduce motion" enabled (that was freezing it).
- New futuristic ACCESS GRANTED screen after sign-in (original design).
- Terms version bumped to 2026-10-31 (everyone sees the updated Watch-together disclosure once).

## Honest limits
- Many sites (Netflix, most big streamers) forbid being shown inside another page; those frames stay empty. Use "Open in a new tab".
- Only YouTube is truly synced (play/pause/seek). Other links are shared pages, not synchronized video.
- The scanner reduces risk; it cannot guarantee a page is safe.
