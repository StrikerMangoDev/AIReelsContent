# v1.3 acceptance traceability — independent source review

25 October 2026. Scope: local implementation only. This matrix maps the frozen `CONTENT-PRODUCT-REQUIREMENTS-v1.md` (A01–A40) and mandatory `FINAL-IMPLEMENTATION-PLAN-v1.3.md` (A41–A52), both in `C:\Users\mango tree\.codex\visualizations\2026\10\01\01a0f855-3091-7531-990b-feb812532655`. It does not replace or reduce those requirements.

Evidence below is repository-relative. **Fixture** means bounded offline behavior is implemented/tested, not the full acceptance scenario. **Partial** means substantial local work remains; **Missing** means required capability was not located; **External** needs separately authorized account/provider or human evaluation. No row is an unconditional production PASS. Auth and end-to-end work currently in progress must receive a subsequent review update.

## Case matrix

| ID | State | Current evidence and remaining acceptance work |
|---|---|---|
| A01 | Partial | `studio/intelligence.js`, `tests/intelligence.test.js`: arbitrary niche and locale inputs; representative AI/cooking/third-niche relevance and editable category taxonomy not demonstrated. |
| A02 | Partial | Niche revision binds research scope; saved reports preserve snapshots. Audience/geography changes do not yet automatically mark every dependent package/evidence mismatch. |
| A03 | Missing | Planning shortlist/template archive exists; category merge/archive and inspectable lineage are separate requirements and absent. |
| A04 | Fixture | `studio/evidence.js`, intelligence/studio fixtures: unsafe/unreadable references have explicit unavailable states; other readable evidence can continue; empty evidence returns truthful saved report with zero synthesis. Sensitive upstream error details are not exposed. |
| A05 | Partial | `studio/content.js`, studio tests validate citations/exact quotes; independent claim attestation exists. Quote presence alone does not prove semantic entailment. |
| A06 | Partial | Library hash changes and server-stamped 24-hour review expiry invalidate approval; explicit human freshness/conflict attestations required (`review-expiry.test.js`). Automated conflict discovery and structured per-source conflict evidence remain absent. |
| A07 | Fixture | Unsupported popularity modes blocked; claim checks independent of demand. No measured-demand connector or quality evaluation. |
| A08 | Fixture | Audience reaction forced insufficient-evidence; unsupported metric modes blocked (`intelligence.test.js`). Competitor/sparse-sample evaluation not exercised. |
| A09 | External | Trending/Most viewed blocked truthfully; qualified metric cohorts/query/window display awaits connector contracts and local fixture implementation. |
| A10 | Missing | URL/article/research-topic intake exists; direct transcript/topic input parity not established. |
| A11 | Fixture | `studio.test.js`: all five platforms, exact selected variants and selected output schemas validated. Five real editorial journeys pending. |
| A12 | Partial | Citation and quote checks exist. Title/hook-to-script promise alignment and semantic numeric support need explicit independent rubric/tests. |
| A13 | Missing | Thumbnail briefs exist; target-size/crop readability, visual-rights disposition and misleading-visual checks not implemented as acceptance gates. Paid rendering remains off. |
| A14 | Partial | Scene timing is free text in `studio/content.js`; untimed-input estimated-timing provenance is not enforced. |
| A15 | Partial | Revision history and bounded instruction-based regeneration exist. Component-specific regeneration/dependency preservation not proven. |
| A16 | Fixture | `job-worker.test.js`, `content-jobs.test.js`: duplicate/CAS/unknown/cancel safeguards; interrupted admission/dispatch require reconciliation, not automatic retry. |
| A17 | Fixture | `policy.test.js`, `free-llm.test.js`, budget tests: default-off, free-only, no paid/model fallback; provider account behavior not tested. |
| A18 | Fixture | Content/settings/evidence hash and revision-bound review invalidate edited content (`studio.test.js`, `dispatch-review.test.js`). Full asset-order lifecycle acceptance pending. |
| A19 | Partial | Exact-version JSON export and independent full-payload review exist. Asset completeness/order, missing-asset disclosure and complete export manifest need dedicated acceptance. |
| A20 | Fixture | Policy blocks publishing; planning dates are metadata (`planning.test.js`, `policy.test.js`). Browser journey side-effect counters pending. |
| A21 | Fixture | `workspaces.test.js`, storage/library tests: fresh membership, cross-owner reads/mutations/export/usage blocked. Managed retrieval/credential interfaces not live-tested. |
| A22 | Partial | Independent reviewer cannot be a cumulative contributor; role/revocation tests pass. Solo path and factual/rights disposition must satisfy full specified rubric. |
| A23 | External | TypeScript/build success is not keyboard, contrast, screen-reader or mobile acceptance. Browser accessibility journey required. |
| A24 | Partial | Confirmed scope, idempotent jobs, old snapshots retained. `research-changes.js` adds exact normalized-text repeat/change/duplicate dispositions; semantic dedup and suppression are not claimed. |
| A25 | Fixture | `budget.test.js`: stale/unknown grant eligibility blocked; held versus settled separated. Actual grant mapping/billing reconciliation external. |
| A26 | Partial | Five API research-to-export journeys pass (`content-journey.test.js`); complete browser journeys and editorial quality review remain. |
| A27 | External | `hexclave-auth.test.js`, AuthProvider tests cover mocked identity boundaries; live Google callback/stable identity/personal workspace verified in isolated local browser; email verification/resend acceptance pending. |
| A28 | External | SDK recovery UI alone does not establish expired/used-link, delivery or outage behavior; new auth work needs review. |
| A29 | Fixture | `workspaces.test.js`: verified-UID target, expiry/revoke/mismatch and last-owner checks; no invitation emails sent. |
| A30 | Partial | Safe redirects, logout/account-switch guards and membership revocation tested. Live SDK logout removes protected workspace UI; retained-token revocation/cross-tab flows pending. |
| A31 | Fixture | `auth-migration.test.js` exercises real Firebase middleware factory, Hexclave middleware, workspace/studio routes and SQLite: mapped UID retains personal/shared packages, membership and review revision history through cutover/rollback; duplicate-email subject cannot access them and vendor admin is not inferred. Runtime provider selector and live vendor sessions remain outside this fixture. |
| A32 | Partial | Quick discovery allows arbitrary input without mandatory references. Trending correctly blocked, so specified researched Trending journey is unavailable. |
| A33 | Fixture | Saved topic detail reads, queued commands and GET polling do not dispatch (`intelligence.test.js`, `job-worker.test.js`). Full browser back/reload counters pending. |
| A34 | Partial | Separate Generate confirmation and selected outputs exist; defaults do not dispatch. Full angle/format plus scope/cost browser acceptance pending. |
| A35 | Fixture | `topic-research-details.ts` and test: suggested keywords have explicit unresearched intent/unavailable volume; observed questions unavailable, editorial proposed questions distinctly labelled; topic expansion displays evidence/angles/uncertainty. No measured keyword or audience data claimed. |
| A36 | Fixture | Latest sorts observed publication time; unsupported Trending requires user selecting a different mode (`intelligence.test.js`). |
| A37 | External | No measured rising/trend adapter; no fabricated baseline/units. Qualification fixtures remain local work once contract selected. |
| A38 | Missing | URL deduplication exists; syndication/original-source grouping and merge lineage are not equivalent and absent. |
| A39 | Partial | No current trend label emitted. Explicit human source/conflict recheck and 24-hour expiry now gate export; ongoing external contradiction detection remains absent. |
| A40 | Partial | Automated citation issues and independent review exist; unified candidate disposition for stale/duplicate/sparse/editorial-fit cases missing. |
| A41 | Partial | SSRF/redirect/byte/time guards and untrusted-source prompt boundary exist (`studio.test.js`). Upload support absent; adversarial prompt/private-data evaluation pending. |
| A42 | Partial | Explicit per-reference availability, partial-readable and empty-evidence reports now tested; managed indexing readiness remains unimplemented. |
| A43 | Fixture | Workspace/library/package isolation and revoked reviewer export tests pass; managed retrieval/index/cache isolation remains unimplemented/external. |
| A44 | Fixture | Worker tests use provider counters; research requires confirmed revision and durable admission. Browser navigation trace still pending. |
| A45 | Fixture | Atomic SQLite/PG budget+job tests, readiness publication and worker CAS pass; hosting/process crash recovery needs operational rehearsal. |
| A46 | Fixture | Exact grant/SKU/project/currency/expiry checks in `budget/policy.js`, budget tests. No grant is treated as verified live. |
| A47 | Partial | Cancellation preserves dispatched holds and unknown outcome; retryable queued cleanup tested. Actual delayed charge/credit reconciliation not connected. |
| A48 | Missing | Storage reservations modeled in budget tests; retention expiry, destructive cleanup authorization, dependency/index deletion and readback absent. |
| A49 | Fixture | Central policy/free-provider boundaries prohibit Gemini and paid media; managed search/answers adapter absent, so no upgrade path enabled. |
| A50 | External | No pre-agreed representative-niche quality/freshness thresholds or scored editorial evaluation. Deterministic fixtures alone cannot establish this. |
| A51 | Partial | Usage UI separates reservations/settlements and avoids live-grant claims. Observed balance/posted offsets/separate-promotion feeds remain unavailable. |
| A52 | Fixture | Research failure preserves prior snapshots; uncertain jobs cannot auto retry; partial/unavailable sources and zero-inference empty reports tested. No fabricated metrics/fallback; browser partial-result usability still needs acceptance. |

## Local blockers to full acceptance

1. **Freshness and contradictions (A06/A39/A40):** server-stamped review time/24-hour expiry and explicit human freshness/conflict attestations now fail closed at approval/export; clock fixtures pass. Remaining gap: per-source conflicting evidence/disposition and candidate qualification; do not claim automated semantic verification.
2. **Retention/deletion (A48):** define record classes and dependency rules before deletion. Preserve required audit metadata without retaining deleted private passages. Explicit cleanup must remove/tombstone all dependent snapshots, revisions, caches and future index documents; prove readback and surface failures. Current lifetime budget caps do not implement retention.
3. **Research completeness (A03/A24/A35/A38/A40/A42):** taxonomy lineage, original-source/syndication grouping, semantic refresh comparison need code and fixtures. Partial reference states and explicit missing keyword/observed-question data are now implemented and fixture-tested. Exact normalized-text refresh diffs and duplicate dispositions now exist, without hiding topics. Avoid pretending URL dedup is source independence.
4. **Content acceptance (A10/A12–A15/A19):** transcript intake and timing provenance, selective regeneration, title/thumbnail promises and asset export completeness need explicit contracts and tests. Do not activate rendering to satisfy a brief-only requirement.
5. **Evaluation (A01/A23/A26/A50):** representative niches/languages, sparse/adversarial evidence and browser/mobile/accessibility checks must be executed and recorded. Thresholds require accountable editorial/product decisions, not invented scores.

## External or separately authorized gates

Exact grant/SKU coverage and current balance; source/API licensing and measured trend access; actual free-provider quota/terms; Hexclave live email/Google/recovery/revocation acceptance; actual billing reconciliation; production identity/database migration and rollback; worker hosting; production deployment. No local matrix can close these by assertion. Do not enable paid services, reconnect billing, send messages or deploy as part of this review.

## Evidence execution scope

Independent worker/storage/workspace subset rerun: **9 passed**, including SQLite/isolated PostgreSQL parity, admission interleavings, retryable cancellation cleanup, cross-workspace checks and contributor review exclusion. Earlier 71-test/build report is recorded in `IMPLEMENTATION-STATUS-v1.3.md`; it is not a 52-case acceptance report. New auth/end-to-end modifications after this review require a dated amendment with actual results.

Independent amendment: reviewed new freshness/contradiction attestations, expiry, refresh comparison and five-platform API journey implementation; **7/7 tests passed** (`review-expiry`, `research-changes`, `content-journey`). These additions close scoped code gaps, not automated fact verification, browser acceptance or provider quality.

A31 amendment: offline migration/rollback HTTP fixture passed (1/1). Only provider verification is mocked; no production auth seam added, real users changed, or cloud called. The test switches middleware explicitly rather than exercising production environment selection. Historical review preservation does not renew or validate that review.

Final independent amendment: full local suite **82/82 passed, zero failed/skipped** after correcting the stale empty-evidence rejection assertion. Reviewed A35 helper/UI and partial-source behavior. Senior reviewer separately reported partial-source 7/7 plus authorization/failure probes. Root reported live public RSS retrieval for AI/cooking/gardening (100 dated entries each); this proves bounded feed access only, not synthesis quality, complete coverage, licensing, trend measurements or end-to-end acceptance. No reviewer cloud/provider writes or synthesis calls were made.
