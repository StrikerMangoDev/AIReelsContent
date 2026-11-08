# Local research acceptance — 26 October 2026

Scope: Find ideas, existing-category reuse, explicit research confirmation, local job execution, saved topic grids, topic details and daily refresh lock. No deployment or paid services.

## Observed results

- AI: 12 topics saved in report `70b14e03acf9687b094d217ef5752226`.
- Astrology: 7 distinct topics saved in report `f54ba97dc39bcaa5a13a63daca210c99`. Overlapping horoscope coverage was grouped; the UI explicitly explains the fewer-than-10 result. The ten-topic target is not met for this snapshot.
- Both reports contain 12 source references. Topic details and source links render. Keywords remain suggestions with unavailable volume clearly marked.
- Repeating `AI content` and `trending astrology content` opened the original categories with `reused=1`. All three baseline category IDs are unchanged. The older five-topic AI report remains available.
- Refresh is disabled while research runs and after today's successful refresh, using the existing India-time daily boundary.
- OpenRouter key metadata after testing: spending limit 0, usage 0. No paid fallback enabled.

## Repairs

- Added opt-in, loopback-only local dispatch for newly admitted research jobs. It does not drain historical jobs or start scheduled research.
- Allowed longer bounded synthesis time, retained ambiguous-outcome protection and added safe provider diagnostics.
- Added one bounded correction for malformed JSON/schema/evidence validation. Transport failures do not automatically retry; validation remains enforced.
- Replaced unsupported generated hook assertions and performance promises with a neutral opener and an explicit unmeasured-performance statement. Applied the same correction as revision 2 of both local reports, preserving revision history.

The two initial failed attempts were reconciled against exact provider receipts before explicit retries. The local process allowance was temporarily 12 for the two acceptance retries and restored to its normal 10 afterward. Daily limits remain enforced; saved report reuse is available without new synthesis.

## Verification and limits

- 124/124 local regression tests passed, zero skipped; build and type checks passed; diff whitespace check passed.
- Senior developer scoped review passed, including regression coverage for bounded correction and unsupported hook removal.
- Evidence artifacts: `../validation/research-live-before.json`, `../validation/research-live-after.json`, `../validation/research-provider-receipts.json`, and `../validation/research-complete-tests.txt` (paths are relative to the implementation directory).
- Research currently uses feed headlines/excerpts and optional supplied reference passages. This is not independent full-article fact checking or measured trend ranking. Titles, editorial angles and other model prose still require source review before publication.
- This acceptance does not rerun downstream content generation, independent review or export. Nothing was deployed, pushed, or enabled in paid cloud services.
