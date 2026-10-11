# LSDKChat update v0.5

New: emoji reactions on messages (press and hold), status likes + private comments + save,
like/comment notification beep (can be switched off), ringtones (6 built-in + your own audio files,
default or per person).

This pack is CUMULATIVE (it also contains v0.3 and v0.4), so it works whatever you have applied before.
It does NOT contain src/config.js, so your settings stay untouched.

## Step 1 - update the database (Supabase)
1. https://supabase.com/dashboard -> your project -> **SQL Editor** -> **New query**.
2. Run the three files in this order, one query each (open in Notepad, Ctrl+A, Ctrl+C, paste, **Run**):
   a. supabase/update-v0.3.sql   (skip if you ran it before - running again is harmless)
   b. supabase/update-v0.4.sql   (same)
   c. supabase/update-v0.5.sql   <- the new one
   Each should say "Success". A red error = stop and send me the text.

## Step 2 - copy the files
Unzip, open `LSDKChat-update-v0.5`, select everything (Ctrl+A), copy, paste into
`C:\Users\mthet\Downloads\LSDKChat`, choose "Replace the files in the destination" and merge folders.
Do not touch `src\config.js`.

## Step 3 - publish
PowerShell:
    cd C:\Users\mthet\Downloads\LSDKChat
    git add .
    git commit -m "v0.5 reactions, status likes/comments, ringtones"
    git push
Wait for the green tick in GitHub -> Actions, then open the site and press Ctrl+F5.
Everyone re-accepts the updated terms once.

## Step 4 - test with two accounts
- [ ] Press and hold (phone) / hold or right-click (computer) a message, voice note or photo: emojis appear. Pick one.
- [ ] Press the + for the full list; tap the same emoji again to remove it.
- [ ] Account A posts a status. Account B opens it, taps the heart, writes a reply. A hears a chime and sees a notice and a badge on the Status tab.
- [ ] A opens their status -> "Activity" shows likes and comments (comments can be deleted / reported).
- [ ] B taps Save on a photo status: the file downloads.
- [ ] Settings -> Notifications: switch off "Status like and comment beep", repeat the like: no beep.
- [ ] Settings -> Ringtones: pick one, press Play, add your own audio file, give one friend a different tone, call yourself from the other account.

## Things to know
- Reactions: one per person per message. Visible to everyone in that chat.
- Comments on a status are PRIVATE replies (only the author and the writer see them).
- Saving: the app offers a Save button, but nobody can stop screenshots or screen recording.
- Ringtones and chosen sounds are stored only on that device/browser. Clearing browser data removes them.
- Beeps and ringtones only play while the app is open in a browser tab, after the person has clicked once on the page.
