# Simple Find ideas

## Product flow

1. Enter any subject in a word or two. Example chips only fill the field; they are not a category whitelist.
2. Optionally use **Help me describe it** for an editable AI suggestion, or add a description manually. Audience, location and reference links remain optional.
3. **Find ideas** checks existing categories in the active workspace before creating anything.
4. A confident difference score of **0–8** opens the existing category. A score **greater than 8** shows a new-category preview requiring confirmation. Uncertain comparisons request clarification and cannot create a category.
5. Confirmation saves the category and, only when already permitted by local policy, starts one free research request. With research disabled, the user may save the category for later.

Scores are internal audit information, not prominent UI. Subject, specialist focus, audience, region and sources matter; wording such as “trending AI content” does not by itself justify duplicating “AI content.” Reusing a category does not establish verified trend rankings.

## Cost and safety

- Clear normalized matches do not call an LLM. Unknown comparisons use one bounded free-provider comparison when available; otherwise they request clarification.
- AI help does not start research. Edited input invalidates the current audit, and delayed responses cannot overwrite newer input.
- Audit records retain comparison reasons, score, actor and library revision fingerprint. Creation validates the audit server-side and rechecks library changes.
- Workspace access and existing budget/provider policy remain authoritative. No paid fallback, deployment or paid-service enablement is part of this change.
- Existing daily manual-refresh and evidence/review rules remain in place.

## Research limits

Any topic can be entered, but evidence coverage depends on the available sources. Non-news topics use an appropriate creative, evergreen or tradition framing; this does not add a new search provider. Astrology and vastu claims must be attributed as traditions, and fictional comedy must be labelled. No fabricated sources, trend metrics or filler records are allowed.

## Review and validation

Product and UX specialists reviewed the flow and supplied acceptance criteria. Automated and local-browser results are recorded after implementation validation; live AI-provider success is not implied by mocked-provider tests.

### Local acceptance, 26 October 2026

- Product/UX review completed; senior developer reviewed and repaired concurrency, audit replay and partial-save recovery. Parent reviewed those repairs.
- Full suite: **115/115 passed**, including route-level scores 8 and 9, specialist constraints, stale-library rejection, UI editing/races and explicit confirmation.
- TypeScript, production build, changed-file ESLint and whitespace checks passed.
- Authenticated Chrome at localhost:5194: “I need trending AI content” opened the existing AI category; “Astrology” displayed a new-category confirmation without saving or starting research.
- Live model calls and schedulers remained disabled. AI assistance and semantic comparison were tested with mocked providers; live semantic accuracy and mobile-device usability remain unverified. Existing five-topic research was preserved without invented filler.
- No deployment or paid-service enablement.

### Live free-help and mobile follow-up, 26 October 2026

- User authorized local free help. Local API process on 3194 now has `CONTENT_LIVE_FREE_CALLS=true`; persistent environment and deployment were not changed. Schedulers remain disabled.
- Reproduced failure: help shared the research/content job quota and received an exhausted-allowance error. Exact `idea-assistance` requests now have a separate maximum of 10 per rolling 24 hours; other jobs retain their existing shared allowance. Unresolved requests still hold quota. SQLite and PostgreSQL contract tests cover both buckets. Migration 007 is local only, not applied remotely.
- Real OpenRouter help succeeded for Astrology and AI. Real semantic comparisons reopened their existing categories; no duplicate categories were inserted. AI exact matching also worked without a model call.
- OpenRouter test-key API reported a zero-dollar limit and zero usage before and after tests. Requests retain zero prompt/completion/request price ceilings and no paid fallback. Existing key expiry is 1 November 2026 at 09:41 UTC.
- Chrome viewport tests at 390x844 and 320x740: input, help, matching and mobile menu exercised; fixed heading word spacing and 15px horizontal overflow on the narrow viewport. Viewport override restored afterwards. This is browser emulation, not physical-device testing.
- Final regression suite: **116/116 passed**. TypeScript, changed-file lint and production build passed. A pre-existing intermittent planning-test fixture now derives review and expiry times from one timestamp; production review validation is unchanged.
- Full research generation was not rerun in this follow-up. Existing research/content allowances and source validation remain enforced.
