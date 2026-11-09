# Content assurance release — 9 November 2026

Implementation: phases 0–3 of [the backend plan](backend-content-assurance-plan.md). Phase 4 remains a separate rendered-media/publication integration.

## Implemented

- Synchronized previously deployed preview fixes to GitHub before the backend release.
- Added version-bound brief/source/content assurance checks, structured blockers, actual job/actor/check records and a private assurance endpoint.
- Added source-capture provenance and future-timestamp checks, claim/output number checks and explicit unknown semantic/creative/source-context reviews.
- Recorded actual generation checks in the existing worker without additional provider calls, paid services or hidden retries.
- Bound approvals and audit records to canonical content/settings/evidence/research/brand hashes so PostgreSQL key ordering cannot invalidate an unchanged package.
- Manual saves and automatic-review requests run real server validation; old drafts do not receive fabricated generation checks. Material changes invalidate independent review and approval.
- Recorded claim/conflict notes and human issue resolutions from the authenticated assigned reviewer. Semantic judgments remain human review, not automatic fact certification.
- Centralized release assessment across approval, export, planner readiness and the disabled publishing route, including current workspace and library-source permissions.
- Included assurance provenance and the current assessment in the text export manifest.

## Verification

Three agents contributed: assurance core, generation-worker integration and independent QA. The final local suite passed **199/199 tests**. TypeScript, Vite production build, targeted ESLint and Git whitespace checks passed. Tests cover missing legacy audits, forged pass flags, ownership isolation, unsupported quotations/numbers, reviewer independence, expiry, source changes, version changes, job idempotency and positive text export/planner readiness.

Live deployment and acceptance results are recorded in `D:/AIReelsContent/validation/ASSURANCE-LIVE-REPORT.md` when completed. The runnable acceptance script is `D:/AIReelsContent/validation/assurance-live-acceptance.mjs`; it creates isolated test accounts and performs a real free-provider request. Do not rerun just to inspect saved results.

## Operational limits

Existing reviews using the previous hash or lacking required assurance need renewed validation/review. Existing draft content is retained. The existing automatic-review action reruns deterministic checks without another generation request.

Live acceptance ratings are labelled controlled test data. They demonstrate server enforcement, not independent human acceptance of an owner's draft. A real noncontributor human review and separate owner approval remain required before that draft is exported as approved content.

Number matching is conservative and can reject equivalent numeric formatting or conversions. It is not semantic entailment. Source credibility, originality, brand fit, rights and audience demand cannot be established by a quotation match or editorial score alone. Missing audience observations remain unknown.

This release does not enable media generation, publishing, research scheduling or paid fallback. Actual rendered media, rights/accessibility/playback acceptance and authorized publication receipts belong to phase 4.
