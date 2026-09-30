# Production setup

Status: local implementation is ready to configure. Cloud credentials, SQL execution and deployed endpoint verification are still required. No cloud setup is implied by the presence of these files.

## Supabase / MangoTree

1. Apply `supabase/migrations/001_signal.sql` in the intended project. This has not been executed remotely or integration-tested against that project.
2. Set `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` on the backend. Use a server-only secret/service-role key. Anonymous/browser keys cannot access the tables or repository function.
3. To transfer local news, configure those values locally and run `npm run db:import`. This transfers articles, not user analytics or old model quota records. Before enabling ingestion during a migration, wait 24 hours after the last old-storage model call to avoid resetting the rolling quota across databases.

## Firebase / Ai Vertical

Use the actual Firebase project ID, not the Vertex project ID. Register/select its web app, enable email/password and Google authentication, and authorize localhost plus the production domain. Set `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_CONFIG` (the public web-app JSON), and `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` (server-only JSON credential from an appropriately authorized Firebase service account).

`ADMIN_EMAILS=yeshaswi3@gmail.com` bootstraps the first administrator. Admin access requires a server-verified token and a verified email; frontend routes alone grant nothing. Prefer server-managed custom admin claims for additional administrators. Firebase provider/domain and revocation checks must be tested on the real project before launch.

Analytics is opt-in, retained for 90 days, and excludes passwords, IP addresses, fingerprints and raw search queries. Dashboard activity covers 30 days; account/event tables display the latest 100 records. Counts describe observed events, not every visitor.

## Vercel

Import `yeshaswi3060/live-ai-updates-`, choose Node 24 and use the included `vercel.json`. Set these server environment variables in the correct Vercel project:

- `STORAGE_PROVIDER=supabase`
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_CONFIG`, `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`
- `ADMIN_EMAILS=yeshaswi3@gmail.com`
- `GOOGLE_CLOUD_PROJECT=ai-vertical-495712`, `GOOGLE_CLOUD_LOCATION=global`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (contents of the local Vertex credential, never committed)
- `GEMINI_MODEL=gemini-2.5-flash`, `MAX_MODEL_CALLS_PER_DAY=2`
- `CRON_SECRET` (cryptographically random, at least 32 characters)
- `NODE_ENV=production`, `ENABLE_SCHEDULER=false`

The included cron runs once daily at 01:00 UTC / 06:30 India time. It collects broad publisher feeds then curates one bounded batch. If the Vercel plan supports twice-daily cron, optionally change the schedule to `0 1,13 * * *`. Persistent storage atomically caps actual model attempts at two per rolling 24 hours, including failures. Page reloads only query storage. Vercel functions must support the configured 300-second duration; adjust to the account's documented limits before deploying. Do not use an in-process scheduler in serverless functions.

News collection covers configured publisher feeds, not the entire internet. Publisher excerpts and Gemini summaries are distinct; per-run Gemini candidates are capped at 40. Geography can represent explicitly named organization association, not a physical event location. Uncertain geography remains unlocated.

After deployment verify `/api/health`, `/api/news`, `/api/activity`, original-source redirects, Google login, email verification, unauthorized admin rejection, consented analytics, and a secret-authenticated scheduled refresh. Monitor failed/degraded runs. Never upload credential JSON files, local databases or `.env` files as static assets.
