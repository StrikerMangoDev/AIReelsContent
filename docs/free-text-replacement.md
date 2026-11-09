# Bounded free text replacement

Automation may admit one distinct replacement operation per research or writing stage after a locally timed-out free model request. This is a new operation, not reconciliation of the old provider outcome. The old job, error, budget hold and automation stage record remain unchanged and inspectable.

Eligibility requires the original durable job to be `dispatch_unknown` with a recorded `MODEL_TIMEOUT`, no generation receipt ID or usable result, the same requesting actor, and no prior `replacementOf` lineage. Its cost reservation must remain unknown, uncancelled, scope-matching and explicitly USD zero under `enforced-provider-max-price-zero-v1`. Research must be free-only; generation must use the free adapter. Any Vertex reservation blocks this path. The account plan and current owner consent are rechecked.

The account runner stores the original and replacement request IDs before admission. The replacement ID is stable across process restarts and distinct from the original. A second replacement is prohibited. Model identity is recorded in new research and writing scopes; a worker with a different configured model rejects before provider dispatch. The adapter continues to enforce its NVIDIA free-model allowlist and zero provider price ceilings.

When a text stage first returns a terminal local timeout, the runner performs read-only eligibility checking and marks the outcome deferred only if that exact operation qualifies. The existing continuation dispatcher can then invoke the runner once to admit the new operation. Reserved/running work, unknown social operations and a timed-out replacement do not request this continuation.

Automatic requests cap model output at 6000 tokens while retaining the existing 110-second local ceiling. Writing directions request compact complete output: three claims/48 claim words, title below 65 characters, website body at most 180 words and one sentence per planning field. These are output-budget directions, not assertions to copy into prose or permission to omit schema fields, attribution or limitations.

Research admission bypasses only the specifically eligible old unknown job under the existing research lease. Writing requires the exact original package/job relationship and no saved usable content. Both operations preserve optimistic revisions, so late original workers cannot overwrite the replacement package or current research state. Quotas, source/assurance checks and publication deduplication remain enforced.

This path never replaces review, render, upload or publication operations. An unknown social receipt stays held for actual readback; no second social dispatch is authorized by a text replacement. No provider completion, zero-cost billing receipt or human review is fabricated.

Acceptance tests: `server/tests/automation-replacement.test.js` covers genuine worker timeout and replacement, retained original holds, one stable replacement, publication exclusion, late original response isolation, research admission, consent changes, Vertex exclusions and model binding. Controlled injected provider outputs are labelled fixtures; they are not live account delivery evidence.
