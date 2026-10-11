# LSDKChat update v0.6

New: **reply to a specific message** (text, photo, voice note...) with a quoted preview; tap the quote to jump to the original.
Fixed: **voice notes** now play straight after recording (and old ones load more reliably).

CUMULATIVE pack (contains v0.3 - v0.5 too). It does NOT contain src/config.js, so your settings stay untouched.

## Step 1 - update the database (Supabase)
1. https://supabase.com/dashboard -> your project -> **SQL Editor** -> **New query**.
2. Run these files in order, one query each (open in Notepad, Ctrl+A, Ctrl+C, paste, **Run**). Skip any you already ran (re-running is harmless):
   a. supabase/update-v0.3.sql
   b. supabase/update-v0.4.sql
   c. supabase/update-v0.5.sql
   d. supabase/update-v0.6.sql   <- the new one (adds replies)
   Each should say "Success". A red error = stop and send me the text.

## Step 2 - copy the files
Unzip, open `LSDKChat-update-v0.6`, Ctrl+A, copy, paste into `C:\Users\mthet\Downloads\LSDKChat`,
choose "Replace the files in the destination", merge folders. Do not touch `src\config.js`.

## Step 3 - publish
PowerShell:
    cd C:\Users\mthet\Downloads\LSDKChat
    git add .
    git commit -m "v0.6 replies, voice note fix"
    git push
If push is rejected: `git pull --rebase` then `git push`.
Wait for the green tick in GitHub -> Actions, open the site, press Ctrl+F5 (on phone: close the tab and reopen).
IMPORTANT: the repo must be PUBLIC with Settings -> Pages -> Source = "GitHub Actions", otherwise the site shows a 404.

## Step 4 - test (two accounts)
- [ ] Press and hold a message -> "Reply" (or hover on computer -> "Reply"). A bar shows who/what you reply to. Send. The reply shows a quote.
- [ ] Tap the quote: chat scrolls to the original and flashes it. Works on photos and voice notes too.
- [ ] Press the X on the bar (or Esc) to cancel a reply.
- [ ] If the original gets deleted, the quote says "Original message deleted".
- [ ] Record a voice note, press play immediately: sound plays and the bar stops at the real length. Try dragging the bar.
- [ ] Other account: the voice note plays without refreshing.

## Things to know
- New voice notes are saved as WAV (bigger: about 2 MB per minute, max 5 minutes ~ 9.6 MB). Old ones stay as they were.
- You can only reply to a message in the same chat.
- If a voice note still misbehaves, tell me the phone/browser - I could not reproduce your exact failure here, only remove the known cause.
