# Alerts when the app is closed - setup (about 15 minutes, once)

1. Run `update-v0.14-push.sql` in Supabase > SQL Editor.
2. Make the VAPID keys (on your PC, in the LSDKChat folder): `npx web-push generate-vapid-keys`
   - Public key -> `vapidPublicKey` in `src/config.js` (safe to be public).
   - Private key -> only in the Supabase function secrets (step 3). Never in GitHub.
3. Supabase > Edge Functions: create a function named `push`, paste `supabase/functions/push/index.ts`, and turn OFF "Verify JWT".
   Secrets (Edge Functions > Secrets): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:you@example.com), `PUSH_SECRET` (any long random text).
4. Run the INSERT line at the end of the SQL file with your function URL and the same `PUSH_SECRET`.
5. Push the app, open Settings > Notifications > Turn on alerts on each device.
