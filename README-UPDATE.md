# LSDKChat update v0.13 — Watch together + movable call window

Cumulative: contains everything since v0.9. If you already ran an older SQL file, skip it; the SQL files are safe to re-run.

## 1. Supabase first (SQL Editor, in this order, skip any you already ran)
1. supabase/update-v0.9.sql
2. supabase/update-v0.9-group-calls.sql
3. supabase/update-v0.11.sql  (games)
4. supabase/update-v0.12.sql  (darts)
5. supabase/update-v0.13.sql  (watch together) — new

## 2. Copy files
Copy everything in this zip over C:\Users\mthet\Downloads\LSDKChat (overwrite). Do NOT touch src\config.js (it is not in the zip).

## 3. Install + push
```
cd C:\Users\mthet\Downloads\LSDKChat
npm install
git add .
git commit -m "v0.13 watch together + movable call window"
git push
```
If push is rejected: `git pull --rebase` then `git push`. Wait for the green tick in GitHub Actions, then Ctrl+F5 on every device (phones: close and reopen the tab).
Everyone must accept the updated Privacy text once (third-party players).

## 4. What's new
- Watch together (direct chats): film icon in the chat header. Paste a YouTube, Spotify, Apple Music or TikTok link.
  - YouTube: play/pause/seek sync for both people. Host can allow the friend to control; friend taps "Ask for control".
  - Spotify / Apple Music / TikTok: cannot be remote-controlled. You get a 3-2-1 countdown, both press play. Drift is on you.
  - Also available from the call screen (Watch together button).
- Movable call window: minimise a call and drag it anywhere; it stays alive while you browse other chats. Video calls get a pop-out (PiP) button that floats video over other apps.

## 5. Test
1. Two accounts, open chat, tap film icon, paste a YouTube link, Start. Other side gets a banner; open it. Press play on one — the other should follow within ~2 s.
2. Try Spotify link → countdown flow.
3. Start a call, minimise, drag the window, switch chats; the call must continue.

## 6. Honest limits
- Not tested against real YouTube/Spotify/Apple/TikTok (my sandbox can't reach them), nor on real phones or real Supabase. Expect first-run bugs; tell me exactly what you see.
- Spotify/Apple Music: full songs need each person logged in to that service in the browser, otherwise 30-second previews. No remote control.
- TikTok: only full video links (not vm.tiktok.com short links); TikTok may block embeds.
- Some YouTube videos disallow embedding; those won't play.
- Mini window works inside the app. PiP floats video only (voice-only calls have none). Closing the tab ends the call; phone browsers may suspend the mic in background.
- Use headphones when watching during a call or you'll get echo.
- Watch together: direct chats only, one session per chat. Screen sharing from phones is still impossible in browsers.
- Game rules (ttt/chess/darts) are client-checked; no push notifications; not end-to-end encrypted.
