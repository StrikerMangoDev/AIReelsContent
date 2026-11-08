# Content finalization validation

8 November 2026. Local implementation only; no deployment, public post, paid generation or account change was performed.

## Checks completed

- Backend agent ran the full suite under Node 24.22.1: **188 passed, 0 failed, 0 skipped**. Environment was isolated from local runtime settings with `DOTENV_CONFIG_PATH` pointing to a nonexistent test fixture path, `NODE_ENV=test`, and `STUDIO_DAILY_GENERATIONS=10`. This avoids the installed default Node 20 runtime (which lacks `node:sqlite`) and a local daily-generation setting overriding test expectations.
- Focused API tests cover evidence-linked score schema, unknown/duplicate sources, missing dimensions, unrounded thresholds, weak-dimension/factual floors, six mandatory attestations, separate review/approval, export and planner bypass prevention, edits and expiry. Existing access-control and budget tests remain in the full suite.
- Frontend agent ran `npm run build` and targeted ESLint successfully. The three affected UI fixtures passed with the new finalization behavior.
- Parent inspected rendered screenshots after correcting invisible disabled primary-action labels. Actual React components were exercised with fixture identity/API data at **1440, 768, 390 and 320 pixels**. No horizontal overflow or browser page errors were observed. The harness verifies blank initial ratings, initial download blocking, reviewer assignment, evidence/rationale request payloads, below-threshold revision status, separate owner approval, provenance-bearing download and expired-review blocking.
- `git diff --check` passed (only Windows line-ending notices).

Reproduce the browser fixture check from the workspace root with Node 24:

```powershell
& 'C:/Users/mango tree/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' validation/content-finalization-browser.mjs
```

Browser evidence: [results](../../validation/content-finalization-browser-results.json), [mobile finalization](../../validation/finalization-owner-390.png), [desktop review](../../validation/finalization-review-1440.png). The fixture harness uses actual components with mocked API/auth; it does not establish live identity-provider or production acceptance.

## Limits and rollout behavior

The gate approves a **text package and production directions**. Rendered assets require separate rights, readability, accessibility, crop, ordering and export verification. A rating is an accountable editorial judgment, not machine proof of factual truth, measured demand, originality across the internet or predicted performance. A linked source ID and rationale record the review basis; the reviewer must inspect that basis.

Existing creator-confirmed approvals and old reviews without the current policy, ratings and attestations cannot finalize content. Their drafts remain stored and editable; they need an independent review and separate owner/editor approval. Content/evidence changes and reviews older than 24 hours require renewed review. Export, planner Ready and the disabled publication path share enforcement; no publishing capability was enabled.

Live authentication, real reviewer-account handoff, production deployment, rendered-media acceptance, end-to-end native publication, full WCAG audit, assistive-technology testing and 200% browser zoom were not checked in this task. Expert policy approval is recorded separately from implementation validation in the flow and consultation documents.
