# LSDKChat update v0.7 - smart tools + accessibility

CUMULATIVE pack (includes v0.3 - v0.6.1). It does NOT contain src/config.js, so your settings stay untouched.

## What is new
- **Notes to myself** (📝 button at the top of the chat list): a private chat only you are in.
- **Mark chat as unread**: press and hold a chat (or right-click, or the ⋯ button, or Chat info). Shows a dot / bold name until you open it. Syncs across your devices.
- **Save messages into collections**: hold a message -> "Save message…". See them in Tools -> Saved.
- **Remind me about a message**: hold a message -> "Remind me…". A pop-up appears when it is due (while the app is open, or next time you open it).
- **Send later**: write a message, press 🗓, pick a time. Or tick "send when they come online" (direct chats, both people must share online status).
- **Tools page** (🧰 button): Search (messages / files / links across all your chats), Library (photos, videos, voice notes, music, documents and links sorted automatically, filter by chat), Saved, Reminders, Scheduled.
- **Open in chat** from any result jumps to that message and flashes it.
- **Accessibility** (Settings -> Accessibility): 5 text sizes, high contrast, reduce motion, screen-reader announcements on/off, dictation (🗣 in chats) with language choice and voice commands ("send", "clear", "stop"). Tab to a message and press Enter for its actions. Chat list has a ⋯ button for keyboard/screen-reader users. Skip link added.
- Terms/Privacy updated for the new features (everyone is asked to accept once).
- "Download my data" now includes saved messages, reminders and scheduled messages.

## Step 1 - update the database (Supabase)
1. https://supabase.com/dashboard -> your project -> **SQL Editor** -> **New query**.
2. Run, one query each (open in Notepad, Ctrl+A, Ctrl+C, paste, **Run**). Skip any you already ran:
   a. supabase/update-v0.3.sql
   b. supabase/update-v0.4.sql
   c. supabase/update-v0.5.sql
   d. supabase/update-v0.6.sql
   e. supabase/update-v0.7.sql   <- the new one
   Each should say "Success". You may see a NOTICE about pg_cron / pg_trgm: that is fine (see below). A red error = stop and send me the text.

Optional (recommended): Supabase -> Database -> Extensions -> turn on **pg_cron**, then run update-v0.7.sql again. This makes scheduled messages go out every minute even if nobody has the app open. Without it they go out whenever anyone's app is open (usually within a minute, since heartbeats run every ~20 s).

## Step 2 - copy the files
Unzip, open `LSDKChat-update-v0.7`, Ctrl+A, copy, paste into `C:\Users\mthet\Downloads\LSDKChat`,
choose "Replace the files in the destination", merge folders. Do not touch `src\config.js`.

## Step 3 - publish
PowerShell:
    cd C:\Users\mthet\Downloads\LSDKChat
    git add .
    git commit -m "v0.7 smart tools and accessibility"
    git push
If rejected: `git pull --rebase` then `git push`.
Wait for the green tick in GitHub -> Actions, open the site, Ctrl+F5 (phone: close the tab and reopen).
(The repo must be PUBLIC with Pages source = GitHub Actions, or the site shows a 404.)

## Step 4 - test with two accounts
- [ ] 📝 -> write a note. The other account cannot see it.
- [ ] Hold a chat in the list -> Mark as unread. Dot appears; open it and the dot goes.
- [ ] Hold a message -> Save message… -> Tools -> Saved shows it; Open in chat jumps to it.
- [ ] Hold a message -> Remind me… -> "In 1 hour" (or pick a time 1-2 minutes ahead) -> pop-up appears when due.
- [ ] Type a message, press 🗓, pick a time 2 minutes ahead, Schedule. Tools -> Scheduled shows "Waiting"; the message arrives on time and the status becomes "Sent".
- [ ] Same with "send when they come online": close the other account's tab, schedule, then open the other account: it arrives.
- [ ] Tools -> Search: type 2+ letters. Files and Links tabs work with an empty box.
- [ ] Tools -> Library: filter by Photos / Voice notes / Documents / Links.
- [ ] Settings -> Accessibility: change text size and contrast; try Tab + Enter on a message.
- [ ] Press 🗣 in Chrome/Edge: speak; say "send".

## Honest limits
- Reminders/sounds only work while the app is open in a tab (no push notifications yet).
- Dictation uses the browser's speech service. isiZulu/isiXhosa/Sesotho may not work in your browser; English and Afrikaans usually do. Voice commands are English only.
- No captions for voice notes/videos yet (needs transcription, a later release).
- Scheduled message text is stored on the server until sent (see Privacy). Max 30 waiting messages per person; text only (no files).
- Saved messages and reminders disappear if the original message is deleted.
- Not end-to-end encrypted (as before). I tested the database logic and the screens here, but not on a real Supabase project: test with two accounts first.
