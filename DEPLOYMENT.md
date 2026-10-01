# Production setup

## Content studio release

Apply `supabase/migrations/003_studio.sql` after migrations 001/002 before deploying the studio. It adds server-only owner-scoped records, revision history, and atomic generation reservations. The database function is available only to `service_role`; browser clients must use the authenticated API. Migration 003 was applied successfully to the connected AI_Information project on 2026-10-01.

The studio uses personal Firebase-UID workspaces. Shared team membership, automatic social publishing, platform trend connectors, and scheduled ingestion of custom library sources are not implemented. Source-library approval records the user's editorial selection, not independent fact verification. Exact quotation and citation checks do not prove semantic truth; human editorial review remains required. Public website publishing requires a verified administrator. Source refresh flags earlier publications when their stored evidence changes.

`STUDIO_DAILY_GENERATIONS` defaults to 10 attempts per owner per rolling 24 hours, separately from background ingestion. Media has a separate 10-request owner limit. Repeated request IDs never start another paid request. Generation runs within the request (120-second timeout for media, 90 seconds for text); interrupted jobs can require a manual retry. Video jobs retain provider operation IDs and support explicit status refresh. No background queue or automatic retry is implied.

For media, set `STUDIO_IMAGE_MODEL`, `STUDIO_AUDIO_MODEL`, and/or `STUDIO_VIDEO_MODEL` to supported Vertex Imagen, speech, and Veo model IDs in your project. Set corresponding `STUDIO_IMAGE_ESTIMATE_USD`, `STUDIO_AUDIO_ESTIMATE_USD`, and/or `STUDIO_VIDEO_ESTIMATE_USD` using current provider pricing; these are operator estimates, not a billing guarantee. Configure `STUDIO_MEDIA_LOCATION` if the model requires a regional endpoint and optionally `STUDIO_VOICE` (default Kore). Video requests create one 8-second portrait clip and require inline video output from the provider; this is not a full reel compositor.

Production assets require `STUDIO_MEDIA_BUCKET` naming an existing private Supabase Storage bucket. Keep it private and restrict file size to 32 MB. The backend service key handles uploads; authenticated owner checks protect downloads. Local SQLite development stores files in ignored `server/data/media`. Provider capabilities stay disabled without model/cost/storage configuration; there are no mock success results.

Release checks: run Node 24 `npm test`, `npm run lint`, `npm run build`; verify `/api/studio/config`, `/api/studio/media/config`, `/api/studio/publications`, authenticated package/library/history requests, source denial cases, and real generation with an authorized account. Test adapters verify contracts but do not establish live provider availability.

Status: local implementation is ready to configure. Cloud credentials, SQL execution and deployed endpoint verification are still required. No cloud setup is implied by the presence of these files.

The install command must be `npm ci --include=dev`, including lifecycle scripts. `postinstall` applies the checked-in `jwks-rsa@4.1.0` compatibility patch: its CommonJS bridge uses dynamic imports for ESM-only jose v6. This avoids the observed Vercel ERR_REQUIRE_ESM without downgrading jose or disabling token verification. The regression test runs with require(esm) disabled and resolves an actual RSA public key. Do not use --ignore-scripts. Remove the patch only when an upstream/runtime fix has been tested on Vercel.

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

The included Vercel cron remains daily at 01:00 UTC to support the confirmed Hobby plan. For six-hour publisher refreshes, configure an authorized external scheduler at 01:00, 07:00, 13:00 and 19:00 UTC (06:30, 12:30, 18:30 and 00:30 India time), or run a persistent worker with ENABLE_SCHEDULER=true and FEED_REFRESH_INTERVAL_MINUTES=360. Avoid duplicate daily/external invocations. Only the 01:00 and 13:00 UTC endpoint invocations also request Gemini curation. Persistent storage atomically caps actual model attempts at two per rolling 24 hours, including failures. Page reloads only query storage. Do not upgrade billing without approval. Vercel functions must support the configured 300-second duration; adjust to the account's documented limits before deploying. Do not use an in-process scheduler in serverless functions. The six-hour schedule is not live until an external scheduler or worker is configured.

News collection covers configured publisher feeds, not the entire internet. Publisher excerpts and Gemini summaries are distinct; per-run Gemini candidates are capped at 40. Geography can represent explicitly named organization association, not a physical event location. Uncertain geography remains unlocated.

After deployment verify `/api/health`, `/api/news`, `/api/activity`, original-source redirects, Google login, email verification, unauthorized admin rejection, consented analytics, and a secret-authenticated scheduled refresh. Monitor failed/degraded runs. Never upload credential JSON files, local databases or `.env` files as static assets.
