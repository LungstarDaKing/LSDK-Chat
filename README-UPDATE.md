# LSDKChat update v0.9

## What's in it
- **Nicknames**: open a person's profile/chat settings, set a nickname. Only you and that person can see it. They see "<you> calls you '<nickname>'". Their real username is never changed.
- **Crop and filters**: for wallpaper, chat backgrounds, status photos and profile pictures.
- **Status comments in your chat**: when someone comments on your status, it lands in your normal chat with them, tagged "Replied to your status". Reply as usual.
- **Group calls** (your uploaded update, merged into the new design). Its SQL is `update-v0.9-group-calls.sql`.

## NOT in this update (not built yet)
Switch voice to video mid-call, screen sharing, movable call window, games, watch-together. See the end of this file.

## Steps (do them in this order)
1. Supabase > SQL Editor. If you have not run them, run `update-v0.3` ... `update-v0.8` in order. Then run, in this order:
   - `supabase/update-v0.9.sql`
   - `supabase/update-v0.9-group-calls.sql`
   Run SQL BEFORE pushing the code.
2. Copy everything from this zip over `C:\Users\mthet\Downloads\LSDKChat`. Do NOT overwrite `src\config.js` (it is not in the zip).
3. In that folder run:
   ```
   git add .
   git commit -m "v0.9 nicknames, crop+filters, status comments, group calls"
   git push
   ```
   If push is rejected: `git pull --rebase`, then `git push`.
4. Wait for the green tick in GitHub Actions, then Ctrl+F5.
5. Everyone gets asked to accept the updated Terms once (legal text version bumped).

## Check it works
- Set a nickname for someone; their chat shows it, your own chat list shows it, they see the "calls you" line.
- Wallpaper / status / avatar: pick a photo, crop and filter screen appears.
- Comment on someone's status from a second account: it appears in your chat with them with a status label; reply works.
- Start a group call in a group; join from another account; the call banner shows; the Calls tab lists group calls.

## Honest limits
- Tested here with mocks and a local database, not on your real Supabase. Report anything odd.
- Calls on strict networks need your TURN worker (already in your config).
- No push notifications, not end-to-end encrypted.

## Still to come (tell me which first)
- v0.10 Games: solo (stickman, emoji song, word puzzles) and 2-player in chat (tic-tac-toe, chess, 20 questions, hangman).
- v0.11 Watch together (YouTube, Spotify, Apple Music, TikTok in a shared player). Taking over another person's real screen is impossible from a browser; the shared player can be controlled by both.
- Call upgrades: voice to video mid-call, screen share (not on most phone browsers), movable call window. Calls cannot survive fully closing the app.
