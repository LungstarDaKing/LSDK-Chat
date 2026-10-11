# LSDKChat update v0.6.1 (small)

Changed:
- Chat background and ringtone are now PER PERSON. Open a chat, tap the person's picture/name (or a name above a message)
  -> their profile shows their bio and a "Just for <name>" section: pick a background (or your own picture) and a ringtone
  (or your own song) for that person only. "Same as all chats" / "Same as everyone" = use your general choice.
- Settings -> Chat background and Ringtones now only set the GENERAL ones (for everyone without a personal choice).
  The list of people's names was removed from Settings.
- These choices are saved only on your device; the other person never sees them.

No database change this time - skip Supabase. (v0.6's SQL must already have been run.)

## Steps
1. Unzip, open `LSDKChat-update-v0.6.1`, Ctrl+A, copy, paste into `C:\Users\mthet\Downloads\LSDKChat`,
   "Replace the files in the destination", merge folders. Do not touch `src\config.js`.
2. PowerShell:
       cd C:\Users\mthet\Downloads\LSDKChat
       git add .
       git commit -m "v0.6.1 per-person background and ringtone"
       git push
   If rejected: `git pull --rebase` then `git push`.
3. Wait for the green tick in GitHub -> Actions, open the site, Ctrl+F5.

## Test
- [ ] Open a chat -> tap the person's picture at the top -> choose a background under "Just for ...": only that chat changes; other chats keep your general one.
- [ ] Same dialog: pick a ringtone, press Play; "Use my own song" adds your audio file (max 30 s, 3 MB) and sets it for them.
- [ ] Settings -> Ringtones: only the general list, no names.
- [ ] Group chats use your general background (per-person backgrounds apply to direct chats).

Note: your own pictures/songs live in this browser only; clearing browser data or using another device means setting them again.
