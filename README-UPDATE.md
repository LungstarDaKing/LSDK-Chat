# LSDKChat update v0.11: GAMES

## What's new
**Play with the person you are chatting with** (open a chat, tap the controller button at the top):
- Tic-tac-toe
- Chess (full rules, check, checkmate, stalemate, draws; pawns that reach the end become queens)
- Hangman (you type a secret word, they guess letter by letter; the word is hidden from them in the database until the game ends)
- 20 Questions (you think of something, they ask up to 20 yes/no questions and can make a final guess; they never see your answer until the end)
Both people see a "game in progress / your turn" strip in the chat and moves arrive live. Starting a game also posts "Started a game: ..." in the chat so the other person notices.

**Play alone** (controller button in any chat, or Tools > Games):
- Stickman run (tap, click or Space to jump)
- Emoji song challenge (guess the song from emojis, 10 rounds)
- Word puzzles (unscramble the letters, hints available)
Best scores are kept on that device only.

## Steps (in this order)
1. Supabase > SQL Editor. If you have not run them already: `update-v0.9.sql` and `update-v0.9-group-calls.sql`. Then run `supabase/update-v0.11.sql` (new, adds the games tables). Run SQL BEFORE pushing.
2. Copy everything from this zip over `C:\Users\mthet\Downloads\LSDKChat`. Do NOT overwrite `src\config.js` (not in the zip).
3. NEW this time: this update adds one library (chess.js). In that folder run:
   ```
   npm install
   ```
   Then:
   ```
   git add .
   git commit -m "v0.11 games"
   git push
   ```
   Make sure `package.json` AND `package-lock.json` are in the commit (git add . does that). If push is rejected: `git pull --rebase`, then `git push`.
4. Wait for the green tick in GitHub Actions, then Ctrl+F5 on both devices (both people need the new version).

## How to test (two accounts that have a direct chat)
1. Account A: open the chat, controller button, Tic-tac-toe. Account B should see the strip "Tic-tac-toe, your turn" and the chat message.
2. Play a few moves each way. Then try Give up, then Play again.
3. Chess: A is white. Tap a piece, tap a highlighted square.
4. Hangman: A types a word; B guesses letters. B should not be able to find the word anywhere before the end.
5. 20 Questions: A thinks of something; B asks; A answers Yes/No/Sometimes.
6. Solo games from Tools > Games.

## Honest limits
- Only one game at a time per chat. Games are in chats between two people (not groups, not Notes to self).
- Tic-tac-toe and chess rules are checked in the app, not by the server: a hacked client could cheat. It does check whose turn it is and the order of moves. Fine for friends; not for ranked play.
- Chess has no clock, no undo, no draw offers, no choosing a promotion piece, no threefold-repetition detection. Hangman is letters only (no whole-word guess).
- 20 Questions relies on the thinker answering honestly.
- Tested: logic tests, a local database test of every rule (turns, secrets, permissions), and screens in a real browser with a mocked server. NOT tested on your Supabase or on real phones with two people. Tell me what breaks.
- No push notifications: a move only shows when the other person has the chat open or opens the app.

## Still to come
- Watch together (YouTube, Spotify, Apple Music; TikTok may be limited). Movable call window.
