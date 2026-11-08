# Live text workflow acceptance — completed locally

**PASS: agent-assisted local acceptance**, 25 October 2026. This supersedes the blocked live-test status in `LIVE-ACCEPTANCE-2026-10-25.md`; its failed-attempt evidence is retained.

## What passed

The real free-model generation, editorial revision, separately authenticated review, owner approval and actual browser downloads completed for Instagram and LinkedIn scripts/platform posts. This is a local text-workflow test, not human publication approval, scientific replication, hosted-source service verification, full v1.3 acceptance or production readiness.

- Package: `422616ab865255eee6b697745fae5ad1`.
- Final approved/exported revision: **9**.
- Content hash: `52b4cb2a1f70be193b515e768e1cfc76ed36e6df03bf53a76238bebd05b339f5`.
- Owner: `hexclave:399262f9ca4b4a29a41f2700029be9cfa743b4f8edb6cb747dc199210086afbc`.
- Assigned reviewer: `hexclave:244b919577bd189058bd75253ba1b1cf3be8a28a8795e0f877f32ba8e11b9daf`, verified not to be a contributor to this package.
- Review notes explicitly identify agent-assisted LOCAL ACCEPTANCE. The server currently hardcodes `independentReview.method = independent-human`; that metadata is not evidence of personal human review in this test. The record was not patched to hide this limitation. Genuine human publication sign-off remains pending.

The first formally valid draft failed substantive review: citations alone did not justify unsupported affiliation, timing, availability and asset claims. An explicit model revision followed by manual corrections through the new text editor resolved these issues. The saved text was compared exactly with the independently reviewed candidate. Its six claim records, exact quotations, source evidence and settings remained unchanged; saving invalidated approval as required.

The reviewer then submitted all six rationale notes through the authenticated review UI. The server record matched the reviewed content hash and notes, while approval remained null. The owner separately approved that version. Both downloaded exports were checked against the approved package, revision, hash, reviewer and source manifest. Markdown also retained all six claim texts and quotations. No publication action occurred.

## Fixes and controls

- Model output selects allowlisted, source-bound passage IDs; the server supplies exact saved quotations. Unknown IDs, mismatched sources and quote overrides fail closed. Extraction is bounded to 12 sources and up to 12 contiguous, URL-free segments per source within its first 7200 characters; passages are not joined or fuzzy-matched.
- Strict grouped citations are converted losslessly into individual markers in prose only. Claim records and quotations are untouched; unknown references still fail validation. Internal hook schema requires citation syntax, and existing post-validation checks reference IDs.
- Existing maximum of two provider calls remains. No paid/model fallback or automatic retry of uncertain jobs was added. Malformed JSON is rejected, not silently repaired.
- Generate and Approve use accessible in-page confirmations, exact-version checks, cancellation and duplicate-submit protection.
- A labelled draft text editor supports editorial corrections through the normal authenticated revision-checked save path. It cannot edit claim records or source quotes; saving resets review and approval.
- Reviewer form fields stay mounted during a same-account identity refresh, with controls and submission disabled until identity checking finishes. Account changes/logout still clear or replace identity state.
- The default model and example configuration now name the successfully tested free NVIDIA Ultra model. Persistent live calls remain off; persistent authentication remains Firebase with Hexclave migration disabled. The local test used process-only Hexclave settings and an isolated SQLite database.

## Validation and cost

- Final offline suite: **91/91 passed**, zero failures/skips. TypeScript, production build and lint passed.
- Independent senior reviews covered passage/citation integrity, configuration, editing, approval, transient identity checking and substantive draft corrections.
- Successful generation and editorial revision each used one `nvidia/nemotron-3-ultra-550b-a55b:free` call. Both completion receipts and independent provider billing lookups reported **$0**. Key metadata confirmed **$0 limit, $0 usage**.
- Earlier rejected attempts and uncertain application ledger entries remain preserved; zero-cost receipts do not silently reconcile those records. A separate reviewer-owned queued job was not executed or modified.
- No paid service, Google billing connection, production environment change, commit, push or deployment occurred. No Google promotional-credit eligibility claim is made.

## Evidence and exports

All evidence is local under `D:/AIReelsContent/validation/`:

- `passage-live-success-receipt.json`, `editorial-revision-success-receipt.json` — successful live model receipts.
- `editorially-corrected-package.json`, `editorially-corrected-review-notes.json` — reviewed saved version and scoped notes.
- `live-independent-review-receipt.json`, `live-approved-package.json`, `live-export-verification.json` — persisted review, approval and downloaded-file checks.
- `exports/content-422616ab865255eee6b697745fae5ad1.md` — downloaded team brief.
- `exports/content-422616ab865255eee6b697745fae5ad1.json` — downloaded production JSON.
- `final-live-flow-regressions.txt`, `final-live-flow-build.txt`, `final-editor-lint.txt` — validation logs.
- `verified-key-usage-after-citation-fix.json` and `billing-gen-*.json` — scoped billing evidence without credentials.

Screenshots: `D:/AIReelsContent/live-independent-review-recorded.png` and `D:/AIReelsContent/live-approved-export-ready.png`.

Remaining limits: real human publication sign-off, broader niche/model reliability, media generation, paid/managed RAG eligibility, production migration and all other previously unverified v1.3 gates. This successful test does not establish that future unreviewed model output is accurate.
