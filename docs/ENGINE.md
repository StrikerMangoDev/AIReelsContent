# Signal AI engine

## Run locally

Requires Node.js 24+ (the SQLite driver is built into Node). Install dependencies with `npm install`. Place the service account credential in the ignored `vertex.json` file or point `GOOGLE_APPLICATION_CREDENTIALS` at a file outside the repository. `.env.example` documents optional overrides; defaults work with the existing credential. Do not put credentials in `VITE_` variables.

1. `npm run dev` starts the API on port 3001 and Vite on port 5173.
2. `npm run ingest` performs one bounded live ingestion.
3. To refresh twice daily, set `ENABLE_SCHEDULER=true` in the backend environment and run `npm run worker` as a separate process.
4. `npm test`, `npm run lint`, and `npm run build` verify the implementation.

Opening or reloading a page never invokes Gemini. The frontend caches filter results for five minutes and refreshes the read-only API every five minutes while visible. Map data does not reload on feed filter changes. The worker interval defaults to 12 hours, with at most two attempted Gemini requests in a rolling 24 hours. This is a periodically refreshed news engine, not second-by-second streaming.

## Flow

Configured publisher RSS/Atom feeds → bounded fetch → source/domain/date validation → normalized candidates → Gemini classification and original summaries → strict JSON validation → transaction → SQLite → API → React.

Fetching is deterministic code, not an instruction asking a model to pretend it scraped a website. No full-article crawler, search index, Agent Builder data store or Cloud Scheduler resource is provisioned here. Feed excerpts are the grounding material. Only publishers in `server/config/sources.js` can supply candidate links. Full-article extraction and Google Search grounding can be added as separate providers with publisher permissions and citation verification. They should not replace the evidence contract.

## Structure and ownership

```text
server/
  config/          Validated environment and trusted source registry
  domain/          URL normalization, article contract, model output validation
  ingestion/       RSS/Atom fetching, size/time limits, date filtering
  prompts/         Versionable editorial instructions
  providers/       Vertex SDK integration and structured response schema
  services/        Ingestion workflow, feed filtering, regional aggregation
  storage/         SQLite migrations, articles, processed IDs, runs, leases, usage
  http/            Public read API, validation, rate limits, safe redirects
  infrastructure/  Retry and structured logging
  tests/           Failure, persistence, timezone, URL and API tests
  index.js         API entrypoint
  worker.js        Scheduled/one-shot ingestion entrypoint
src/
  services/        Frontend API client
  hooks/           Polling, cancellation and request state
  types/           Shared frontend response types
  components/      Map, backgrounds and reusable UI
  pages/           Public news experience
docs/ENGINE.md     Operations and architecture
```

## Data contract

The database owns ID, title, original publisher URL, source, publication timestamp and evidence excerpt. Gemini can supply only relevance, summary, category, regions, region evidence and tags. Unknown IDs, duplicate IDs, omitted candidates, invalid categories and unexpected fields reject a model batch. No generated article URLs or generated timestamps are accepted. Titles and URLs come from the feed unchanged except canonical tracker removal.

Regional labels require evidence from the actual excerpt. Publisher country and assumed company headquarters are not valid geographic evidence. This is model-assisted classification, not a formal independent fact-check. Uncertain geography stays global. Human review could be added in the deferred admin system.

Today is the publisher publication date in the viewer's IANA timezone. Counts measure unique stored articles in the monitored sources, not the number of inventions or a country's AI progress. Multiple publications about one event can still count separately. One multi-region article contributes to each applicable region but only once to the global total. The map distributes one marker per regional article within geographic boundaries, up to 80 per region; counts remain exact. These are approximate regional placements, not verified city/event coordinates. Today and last-72-hours activity are selectable. Unattributed stories are explicitly counted rather than assigned invented locations.

Article cards link to `/api/articles/:id/source`, which returns a 302 redirect to the stored publisher URL. There is no arbitrary `url=` redirect and no intermediary model-written article page.

## Reliability and cost controls

- HTTP fetches: 15-second timeout, 3 MB limit, no redirect following, two attempts for transient errors; individual source failures do not discard good feeds.
- Gemini: 60-second request timeout; no automatic retry. One batch of up to 40 candidates per run, selected round-robin across sources. A transactional rolling 24-hour quota permits at most two attempted requests, including failed attempts, even with a higher requested limit. Legacy recent counters are carried forward conservatively at migration instead of resetting the quota. All manual and scheduled ingestion must share this repository.
- Images: approved publisher pages supply Open Graph cover images when permitted by robots.txt. Fetches have bounded size/time and reject redirects. Research papers use category fallbacks. Image loading is asynchronous/lazy and broken images fall back gracefully. `npm run images:refresh` repairs existing records without calling Vertex.
- SQLite transactions ensure article writes and processed IDs commit together. Canonical URL IDs and unique URLs avoid repeat insertion. Rejected/irrelevant candidates are marked processed only after a validated complete response.
- Cross-process expiring lease avoids overlapping workers on the same SQLite database. API and worker are separate processes. Lease renewed before each batch. WAL and busy timeout handle normal read/write overlap.
- Previous data survives failed jobs; run status is exposed to readers. Logs contain status codes and IDs, not credentials or raw SDK responses.
- API: query validation, pagination, request IDs, security headers, rate limits. No publicly exposed ingestion trigger or admin write API.
- Credential is Git-ignored; Vite denies serving it and the backend directory. Production should serve only `dist/`, never the repository root.

The daily request ceiling is not a monetary budget. Credits and billing are managed by Google Cloud, and the service-account JSON does not reveal remaining credits. Configure project billing alerts separately. Scheduler is disabled by default to avoid unintentional continuous usage.

## Deployment boundaries

### Planned Supabase storage

The storage boundary is `server/storage/repository.js`. Supabase is not connected yet. When credentials are supplied, replace that implementation with an asynchronous Supabase repository, update callers to await storage operations, migrate article/run/processed tables, and implement quota reservations/worker leases as atomic PostgreSQL functions. A service-role key stays only on the backend; configure RLS and public read policies deliberately. The browser will continue reading the stored feed through `/api`, never invoking Vertex. Do not use process-local counters for the two-call quota when deploying multiple instances.

This implementation is suitable for a single API instance and one worker with a durable local SQLite volume. Deploy behind HTTPS with same-origin `/api` routing. Set the API bind host explicitly for your container, supervise processes, retain/back up the database, and configure health checks. Static frontend hosting must route browser paths to `index.html` and `/api` to the API service.

For multiple instances, replace SQLite/local leases with a managed PostgreSQL repository and durable job queue, use managed identity instead of a checked-in key file, and add monitoring, backup restore tests, retention and production load tests. SQLite on ephemeral/serverless storage would lose data. No claim of failure-proof operation or automated Cloud resource provisioning is made.

## Google references

- [Google Gen AI SDK](https://googleapis.github.io/js-genai/release_docs/index.html)
- [Structured output sample](https://github.com/googleapis/js-genai/blob/main/sdk-samples/generate_content_with_response_schema_accept_json_schema.ts)
- [Google Search grounding](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/ground-with-google-search)

These are reference points for the server integration. A service account requires Vertex permissions, enabled API, billing and access to the configured model. Defaults use `gemini-2.5-flash` on the global endpoint; model availability may require adjusting `GEMINI_MODEL`.
