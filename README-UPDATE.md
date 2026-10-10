# LSDKChat update v0.4

Adds: voice notes, free voice + video calls, Chats / Status / Calls tabs, status updates
(stories), typing bubbles, "Seen" ticks, unread counts, a Settings page (privacy switches,
theme, chat backgrounds incl. your own picture) and a new look.

This pack is CUMULATIVE: it contains everything from v0.3 too, so it works whether or not you
already applied the v0.3 update. It does NOT contain `src/config.js`, so your settings are safe.

## Step 1 - update the database (Supabase)  ~3 minutes
1. Open https://supabase.com/dashboard and open your project.
2. Left menu -> **SQL Editor** -> **New query**.
3. Open `supabase/update-v0.3.sql` from this pack in Notepad, press Ctrl+A, Ctrl+C. Paste it into
   the SQL Editor and click **Run**. (If you ran v0.3 before, running it again is harmless.)
   You should see "Success. No rows returned".
4. Click **New query** again. Open `supabase/update-v0.4.sql`, copy everything, paste, **Run**.
   You should see "Success". A yellow NOTICE about "realtime policies" is fine; it only means typing
   bubbles may not work (everything else will).
5. If you see a red error, stop and send me the exact text. Do not run anything else.

## Step 2 - put the new files into your project  ~2 minutes
1. Unzip this pack. Open the folder `LSDKChat-update-v0.4`.
2. Select everything inside it (Ctrl+A) and copy.
3. Paste into `C:\Users\mthet\Downloads\LSDKChat` and click **Replace the files in the destination**
   (say "yes" to merge the `src`, `supabase`, `tests` folders).
4. Check that `src\config.js` is still the one with your name/email (it is not in the pack, so it is untouched).

## Step 3 - (optional) test on your own computer
In PowerShell:
    cd C:\Users\mthet\Downloads\LSDKChat
    npm install
    npm run dev
Open the address it prints (usually http://localhost:5173). Stop with Ctrl+C.

## Step 4 - publish to the live app
In PowerShell, inside the project folder:
    git add .
    git commit -m "v0.4 voice notes, calls, status, settings"
    git push
(If push is rejected: `git pull --rebase` then `git push` again.)
Then open your repo on GitHub -> **Actions**. Wait for the newest run to get a green tick (1-2 minutes).
Then open https://lungstardaking.github.io/LSDK-Chat/ and press **Ctrl+F5** (hard refresh).
Everyone will be asked to accept the updated Terms once - that is expected.

## Step 5 - test with 2 accounts (use a normal window + a private window)
- [ ] Send each other one message, then press the phone / camera icon: the other window rings, accept, talk.
- [ ] Voice note: press the microphone, speak, press the arrow. It plays on the other side.
- [ ] Type in one window: the other shows bubbles. Read a message: the sender sees "Seen".
- [ ] Status tab: post text and a photo; the other account sees a ring around the picture.
- [ ] Settings: change the chat background, upload your own picture, toggle last seen / read receipts.
- [ ] Calls tab shows the call history.

## Known limits (be honest with testers)
- Calls only ring while the app is open in a browser tab. No push notifications.
- Calls connect directly between devices. Some networks (strict Wi-Fi, some mobile data) block that.
  Fix later by adding a TURN relay: in `src/config.js` add
      iceServers: [{ urls: 'turn:YOUR-SERVER:3478', username: '...', credential: '...' }],
  (a free/low-cost TURN service such as Metered or Cloudflare can provide these values).
- Expired status files are deleted when their author next opens the app.
- Chat backgrounds are saved only on that device.
- Not end-to-end encrypted (see my advice message).
