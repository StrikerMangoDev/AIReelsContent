# Backend content assurance implementation plan

Prepared 9 November 2026. Scope: enforce the approved expert process while creating sourced text packages, then release only the independently reviewed version. This is an implementation plan, not a claim that the proposed additions are deployed.

## Product outcome

Every exported text package must have a traceable brief, captured source passages, claim checks, recorded editorial checks, independent human ratings and separate owner approval. Failed or missing required checks block release and explain what must change. “Reviewed with evidence” is the correct assurance: citation integrity and ratings cannot guarantee factual truth, originality or virality.

The November 8 expert consultation is policy provenance. It is not a review of each future generated package. Runtime records must never imply that a named specialist participated unless that specialist actually returned a recorded response for that version.

## Existing controls to retain

| Existing implementation | Responsibility |
| --- | --- |
| `server/studio/evidence.js`, `evidence-passages.js`, `library.js` | Safe source intake, captured passages and reviewed reusable sources |
| `server/studio/content.js`, `server/prompts/social-manager.md` | Requested formats, attributed claims, supplied passage IDs, citation validation and bounded model correction |
| `server/studio/job-worker.js` | Durable generation/research jobs, budget reservation, preserved drafts and failure recovery |
| `server/studio/finalization.js` | Seven ratings, mean ≥8, every dimension ≥6, factual accuracy ≥8; rationale and evidence IDs |
| `server/studio/approval.js` | Noncontributor review, exact-version binding, 24-hour expiry and separate owner approval |
| `server/studio/routes.js`, `planning.js` | Review assignment, approval, export and planner readiness enforcement |

Current checks are substantial, but a matching passage and valid claim marker do not establish semantic support for every sentence. Several rights/freshness/accessibility checks are human attestations. Existing policy advice must not be presented as executed research or rendered-media acceptance.

## Required backend flow

1. **Freeze the brief.** Capture audience, objective, niche, language, brand reference/version, platforms and selected formats. Record any inferred values as assumptions. Preserve the existing revision and authenticated workspace ownership.
2. **Prepare research evidence.** Record source URL, publisher, event/publication/retrieval dates where known, evidence hash, captured passages, capture type and limitations. Separate publisher claims, independently corroborated findings, editorial inference, fiction/tradition and unknowns. Domain reputation helps triage; it is not a credibility certificate.
3. **Assess source sufficiency.** Check whether the selected passages support the intended scope. Missing dates must prevent unsupported “latest” wording; dates are not invented. Source conflicts become explicit issues. Audience demand and competitor comparisons require their own observed evidence or remain unknown; publisher feature documentation does not establish demand. Independent corroboration requirements must depend on claim risk, not an arbitrary two-link rule.
4. **Generate the requested content.** Reuse the existing passage-based generator and correction allowance. Preserve attribution, uncertainty and the requested output scope. Store generated content as a draft, never as approved output.
5. **Run automatic checks.** Apply existing schema/citation/scene/output checks, then record claim coverage, unsupported numbers/dates, scope changes, hook/body promise mismatch and any comparison limitations. Deterministic findings can block release. A model can suggest semantic or creative findings, but its verdict must remain labelled automated and cannot satisfy human review.
6. **Record creative checks.** Check clarity, language, platform fit, brand fit, CTA suitability and comparisons against an identified available baseline. Originality is limited to that baseline. Store concerns and suggested revisions; do not fabricate audience reactions or performance scores.
7. **Independent human review.** The assigned noncontributor reviews the complete saved text and each claim against its source, resolves issues and supplies all seven evidence-linked ratings. Keep current thresholds, expiry and rights/freshness/contradiction/accessibility attestations. Unknown core ratings remain review-required; do not calculate a passing partial mean.
8. **Owner approval and export.** Re-run one shared release check at approval, download, planner readiness and any future publication endpoint. A current passing review and a separate authorized approval must match the same content/settings/evidence version. Include the assurance manifest in the export.
9. **Production and publication.** Text approval covers text only. Rendered graphics/audio/video require separate asset, rights, accessibility and playback acceptance. Publication requires separate authorization and provider receipts. Keep currently disabled capabilities disabled throughout this text-assurance work.

## Minimum data changes

Reuse existing package/revision/history and job storage. Add an `assurance` record to the package; do not introduce a new orchestration service or sixteen model calls per package.

- `policyVersion`, `contentHash`, `briefHash`, `sourceHashes`, `brandVersion`.
- `checks[]`: stage, check code, status (`passed`, `failed`, `unknown`, `not_applicable`), method (`deterministic`, `model`, `human`), evaluator identity or model/version, checked time, evidence/passage/claim IDs, rationale and limitations. Not-applicable requires a reason and is permitted only for optional checks.
- `issues[]`: stable code, severity (`blocker` or `warning`), affected field/claim, evidence references, status, resolution rationale and resolver identity. A source change or content edit invalidates matching resolutions. Do not trust client-supplied pass flags or evaluator identities.
- `stageResults[]`: actual run ID, stage, scope hash, result and start/completion time. Use references to stored reports rather than duplicating entire source texts.
- `releaseAssessment`: computed readiness and blocking reasons. Compute this on the server; do not accept it from a client or treat a cached result as authorization.

Retain `status` for job execution and `editorialStatus` for editing/approval. Do not replace them with a second conflicting workflow state machine. Stage readiness is derived from records, existing review and approval.

Model evaluations count as contributions, not independent human identities. Human review remains mandatory. All assurance reads/writes inherit package workspace access, and history must retain who ran or resolved a check. Existing drafts get `review_required` when required assurance is absent; never backfill fabricated successful checks.

## Implementation sequence

### Phase 0 — synchronize the release baseline

Implementation/release owner checks current local and remote history and synchronizes the three previously reported local UI commits if still absent. Verify production's actual revision before changing it. Preserve unrelated work. The November 8 reports are evidence of that run, not today's live status.

Acceptance: remote contains the intended deployed code, the tree is understood, and a future Git deployment cannot silently revert the preview fixes.

### Phase 1 — establish the shared release gate

Extend `finalization.js` with the assurance schema and a pure server assessment function. Reuse `approval.js` checks; route `routes.js` approval/download/publishing and `planning.js` readiness through the same assessment. Include fresh library status and current workspace permissions at the boundary. Keep the existing exact-version and expiry behavior.

Add a read-only package assurance response and augment the existing export manifest with completed checks, unresolved limitations and scope. Check every caller of the existing approval helpers before refactoring them.

Acceptance: missing required checks, unknown core ratings, blockers, stale hashes, expired reviews and unauthorized reviewers block every release path consistently. Low ratings remain saved for revision. A complete qualifying review plus separate approval permits text export only.

### Phase 2 — record real generation-stage checks

In `content.js`, produce structured validation findings using existing validation logic. In `job-worker.js`, save generation and automatic-check outcomes with their actual inputs/version. Extend research handling in `intelligence.js` and evidence capture only where additional provenance is missing. Preserve existing budget, idempotency, cancellation and recovery controls.

Use the existing generator correction allowance; do not add hidden retries, extra unbudgeted model calls or automatic paid fallback. Failed attempts preserve the previous draft and cannot leave its old approval applicable to new output. Failed validation may retain diagnostics but must not become releasable content.

Acceptance: success has a matching assurance record; failed/truncated/unsupported output cannot release; duplicate delivery cannot duplicate costs; an uncertain provider outcome requires reconciliation.

### Phase 3 — add explicit issue resolution and review evidence

Extend assigned-review handling in `routes.js` to return stage findings and accept claim-specific support/conflict resolutions. Require references and rationale for blocking issues, with permission checks and optimistic revisions. Deterministic structural failures must be corrected, not dismissed by attestation. Preserve existing independent-review and separate-approval requirements.

Begin with deterministic checks and human review. Add a separate model-assisted semantic/creative review only after its usefulness is demonstrated and its cost fits an explicitly configured budget. It remains advisory, records model provenance and never supplies human attestations or editorial ratings.

Acceptance: missing reviews never appear as passes; contributors cannot approve their own review; material edits, source changes and expiry invalidate release readiness. Every issue has an inspectable outcome.

### Phase 4 — production handoff, separately scoped

Add media acceptance only when actual media generation is enabled by a separate authorized task. Bind actual ordered assets/hashes, rights/consent evidence, captions, audio/playback and mobile checks to an independent review. Calendar/publication integration subsequently binds approved versions, accounts, timezone and provider receipts.

Acceptance: text manifests cannot certify rendered assets or publication. No paid generation or publishing is enabled by this plan.

## Verification and rollout

Extend the existing `finalization`, `studio-download`, `planning`, `dispatch-review`, `review-expiry`, `evidence-passages`, `content-jobs` and `generation-jsonb` tests where their actual behavior changes. Cover:

- Valid quotation with an unsupported or scope-changing claim; unsupported headline/date/number; unresolved contradictory evidence.
- Missing required stage, false client pass flags, missing ratings and threshold boundaries using the unrounded mean.
- Self-review, contributor review, lost workspace access, cross-workspace reads and stale concurrent writes.
- Edits, evidence refresh, changed source approval, expired reviews and approval invalidation.
- Worker redelivery, provider failure, budget exhaustion, cancelled reservations and uncertain dispatch outcomes.
- One real accessible primary-source journey: brief → evidence → generation → findings → real noncontributor review → owner approval → text export. Label test inputs; do not fabricate a human review to finish acceptance.

Release behind the existing capability/configuration controls. Apply only additive storage changes needed by the actual repository design. Verify existing package data and source access remain private. Validate preview first, then deploy under the owner's existing project authorization once changes and checks are reviewable. Roll back code safely if necessary; do not erase saved drafts or assurance history. If rollback removes enforcement, block release endpoints until enforcement is restored.

Done means all release paths reject invalid examples, the real reviewed example exports a provenance-bearing text package, and documentation distinguishes automatic validation, human judgment and unverified production claims. A passing test suite alone is not completion of editorial or media acceptance.

## Ownership and decision

Engineering owns server implementation and job integrity. Research/writing/creative specialists supply the recorded stage criteria and actual assigned reviews. Independent QA reviews the software evidence; the assigned noncontributor reviews real content; the owner/editor approves release. Production specialists own rendered-media acceptance when that phase is authorized.

Recommended next build: Phases 0–3 for sourced text packages. Phase 4 remains a separate production integration. This closes the current audit and release-enforcement gaps while reusing the existing backend.
