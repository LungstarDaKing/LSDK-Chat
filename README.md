# LSDKChat

Small real-time chat app: vanilla JS + Vite front-end, Supabase (Postgres, Auth, Realtime) back-end, hosted on GitHub Pages.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # UI smoke tests (no network needed)
npm run build      # production build into dist/
```

## One-time Supabase setup
1. **SQL Editor** -> paste all of `supabase/schema.sql` -> Run. (Destructive: it recreates the LSDKChat tables.)
2. **Authentication -> URL Configuration**
   - Site URL: your deployed URL, e.g. `https://<user>.github.io/LSDKChat/`
   - Redirect URLs: add that URL and `http://localhost:5173/`
3. **Authentication -> Providers -> Email**: keep "Confirm email" ON for real users. Set minimum password length to 10.
4. Recommended: **Authentication -> Attack Protection** -> enable CAPTCHA; consider custom SMTP (the built-in sender allows only a few emails per hour).
5. Edit `src/config.js`: set `operatorName`, `contactEmail`, `jurisdiction`, `dataRegion` (shown in the legal pages).

## Deploy to GitHub Pages
1. Push this folder to the `main` branch of your GitHub repo.
2. Repo **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.

## Reviewing abuse reports
Supabase -> Table Editor -> `reports` (not readable from the app). Set `resolved_at` when handled.

## Changing the legal text
Edit `src/pages/legal.js`, then bump `termsVersion` in `src/config.js`: every user is asked to accept again.
