# LSDKChat update v0.8 - the new look

CUMULATIVE pack (includes v0.3 - v0.7). It does NOT contain src/config.js, so your settings stay untouched.
Group calls, translation and Music Mode are NOT in this pack (parked for later).

## What is new
- **Completely redesigned look** ("kasi night"): deep-ink navigation rail, King-violet and Crown-gold colours, Bricolage Grotesque + Instrument Sans fonts (bundled, nothing loads from Google), new logo and app icon, Ndebele-inspired diamond wallpaper (new default chat background "Kasi"; anyone who already picked a background keeps theirs).
- **Desktop**: 3 columns (nav rail | chats | conversation). **Phone**: bottom tab bar (Chats, Status, Calls, Tools, You).
- **Chat list**: last-message preview ("You: ...", sender name in groups, Photo / Voice note labels), time or day, unread badge, Unread / Groups filters, search bar (Ctrl+K), unsent drafts shown as "Draft: ...". Needs the new SQL (below); without it the list falls back to the old status lines.
- **Messages send instantly** (clock icon, then ticks). If the network fails the bubble stays with **Not sent - Retry / Delete** instead of vanishing.
- Cleaner bubbles (no "You" label, names only in groups, coloured per person), hover toolbar (reply / react / more), proper day dividers (Today / Yesterday), **jump-to-latest button with new-message count**, loading skeletons, friendly empty states.
- **Photo viewer** (click a photo), redesigned voice player and file cards, custom icons everywhere instead of emoji, toasts with icons, rounded dialogs (bottom sheets on phones).
- New sign-in / register page with a password show/hide button.
- **Install as an app**: the site now has a web-app manifest, so Chrome/Edge/Android offer "Install app" and iPhone "Add to Home Screen" with the new icon.
- Drafts are remembered per chat on this device.

## Step 1 - update the database (Supabase)
1. https://supabase.com/dashboard -> your project -> **SQL Editor** -> **New query**.
2. If you have already run v0.3 - v0.7, you only need: **supabase/update-v0.8.sql** (open in Notepad, Ctrl+A, Ctrl+C, paste, Run). It should say "Success". If you skipped earlier ones, run them in order first (v0.3, v0.4, v0.5, v0.6, v0.7, then v0.8).

## Step 2 - copy the files
Unzip, open `LSDKChat-update-v0.8`, Ctrl+A, copy, paste into `C:\Users\mthet\Downloads\LSDKChat`, choose "Replace the files in the destination", merge folders. Do not touch `src\config.js`.
(New files: src/theme.css, src/fonts.css, src/ui/icons.js, src/assets/*, public/manifest.webmanifest and icons. `package.json` is unchanged - fonts are bundled locally.)

## Step 3 - publish
PowerShell:
    cd C:\Users\mthet\Downloads\LSDKChat
    git add .
    git commit -m "v0.8 new look"
    git push
If rejected: `git pull --rebase` then `git push`.
Wait for the green tick in GitHub -> Actions, open the site, **Ctrl+F5** (phone: close the tab and reopen; installed app: close and reopen it twice).

## Step 4 - check it
- [ ] Sign-in page shows the violet/diamond design; sign in.
- [ ] Desktop: left rail has Chats, Status, Calls, Tools, You. Phone: tab bar at the bottom.
- [ ] Chat list shows previews and times (if not, v0.8 SQL was not run).
- [ ] Send a message: it appears at once. Turn off Wi-Fi, send another: it shows "Not sent - Retry"; turn Wi-Fi on, press Retry.
- [ ] Scroll up in a long chat while the other account sends: a round arrow with a number appears; press it.
- [ ] Click a photo: viewer opens (Esc closes).
- [ ] Type half a message, switch chat: the list shows "Draft: ...". Come back: text is restored.
- [ ] Dark mode (Settings -> Appearance -> Dark) and a phone.
- [ ] Chrome/Edge address bar -> "Install LSDK Chat".

## Honest limits
- I tested the screens (desktop + phone, light + dark), instant-send and failed-send behaviour, the database function and the production build here, with a simulated backend - not on a real Supabase project with two real accounts. Test that first.
- The app is still a web page: no push notifications when closed, no offline mode (no service worker). "Install" gives you an app icon and window, not background notifications.
- Calls on strict networks (some mobile data / campus Wi-Fi) may need a TURN server; unchanged from before.
- Not end-to-end encrypted (as before).
- The old emoji icons in a few rarely-used spots (Status viewer text) may still look plain; say so and I will polish them.
