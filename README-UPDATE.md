# LSDKChat update v0.12: call fixes + screen sound + group video/screen + DARTS

This zip contains EVERYTHING (v0.11 games included). You can install it straight over v0.10 or v0.11.

## What changed
**Fixes to calls (v0.10 repairs)**
- 1-to-1 calls now use your TURN relay too (before, only group calls did). This is the big one for phone-to-phone calls on mobile data: without a relay many carrier networks cannot connect directly.
- Screen sharing now carries SOUND (see limits below), with the echo guard on (the other person does not hear themselves).
- A shared screen is kept separate from the person's camera, so the call audio and the screen audio never get mixed up. If the browser blocks sound, a gold "Tap to hear the shared screen" button appears.
- You see "You are sharing your screen and its sound" or a clear notice when the share has no sound.

**Group calls**
- Switch from voice to video during a group call (camera button).
- Screen sharing in group calls, with sound, from any person (also someone who joined late sees the running share). The shared screen takes the big space and everyone's tiles shrink into a strip.

**Darts (new two-player game)**: 301, three darts a turn. A cross moves over the board; tap Throw (or the board) when it is where you want it. First to exactly 0 wins. Going past zero is a bust and your turn's score is lost. Open a chat > controller button > Darts.

## Steps (in this order)
1. Supabase > SQL Editor. If not run yet, in order: `update-v0.9.sql`, `update-v0.9-group-calls.sql`, `update-v0.11.sql`. Then run the new **`update-v0.12.sql`** (adds darts only). Run SQL BEFORE pushing.
2. Copy everything from this zip over `C:\Users\mthet\Downloads\LSDKChat`. Do NOT overwrite `src\config.js` (not in the zip). Make sure your `src\config.js` still has `turnUrl` set (that is what the relay needs).
3. In that folder:
   ```
   npm install
   git add .
   git commit -m "v0.12 call fixes, screen sound, group video and screen share, darts"
   git push
   ```
   If push is rejected: `git pull --rebase`, then `git push`.
4. Wait for the green tick in GitHub Actions, then Ctrl+F5 on every device in the test.

## How to test
- 1-to-1: voice call, tap the camera button on one side, then tap the monitor button (computer only). Play a YouTube tab and share THAT TAB with "Share tab audio" ticked: the other person should hear it.
- Phone to phone calling: call over mobile data on both phones (not Wi-Fi). It should now connect through the relay.
- Group: start a group voice call with 3 people, one taps camera (switch to video), another shares a tab with sound.
- Darts: start from a chat, take a turn each.

## Honest limits (read this)
- **Screen sharing from a phone is NOT possible in a web app.** Chrome on Android and Safari on iPhone do not offer the browser feature (getDisplayMedia). The button simply does not show on those phones. A phone can WATCH a shared screen (with sound), and can switch to video. The only way to share a phone's screen is a real Android/iOS app (an Android app wrapper is possible later; iPhone is harder). If a phone browser adds the feature, the button will appear on its own.
- **Sound sharing works on Chrome and Edge on a computer only**, and only when you tick "Share tab audio" (share a browser tab) or, on Windows, share the entire screen with "Share system audio". Firefox, Safari and any window-only share on Mac give no sound. The app tells you when a share has no sound.
- Group screen share: everyone connects to everyone, so a sharer uploads the picture to each person. With 5 others on a slow connection it will stutter. Limit is 6 people in a group call.
- Tested here with REAL browser WebRTC (two people in a call and three people in a group call, with a fake camera and a fake screen with a tone): voice to video, screen with sound, both sides changing at once, the larger-id person sharing, a late joiner seeing a running share. NOT tested on real phones, real networks or your Supabase.
- Darts: scoring is worked out in the app (like tic-tac-toe and chess), so it is for friendly games. Straight finish, no doubles needed. 

## Still to come
- Watch together (YouTube / Spotify / Apple Music in one shared player). Movable call window (use the app during a call).
