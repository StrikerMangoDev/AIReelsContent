# Shared research library — local implementation

Implemented 25 October 2026. No deployment or paid services enabled.

## User flow

1. Select a shared workspace in **Manage or switch workspace**. Personal research remains private.
2. Search the visible collection library (for example, AI) and open an existing collection. Every workspace member may read it, including viewers. Opening, reading topic details and searching saved collections invoke no model.
3. If needed, an owner/editor enters a brief and confirms research. Equivalent saved scopes reuse the existing snapshot; an equivalent queued/running job is reused instead of reserving another allowance. Scope comparison includes audience, locale, time window, references and other preferences, not just the category name.
4. Research aims for 10–12 distinct supported topics, displayed as cards. Duplicate normalized titles and unavailable citations are rejected. Fewer topics remain valid when evidence is insufficient; the UI explicitly displays the shortfall rather than manufacturing cards. Existing short reports are not automatically regenerated.
5. Select any card to see evidence and creative details, then create a draft. All twelve indexes are accepted. Generation, factual review, approval and export retain existing controls.
6. **Refresh collection with new research** requires a separate confirmation. It consumes a research allowance only when dispatched; ordinary reuse does not. Dates remain visible because cached snapshots are not assumed current. Historical snapshots are preserved; the previous collection remains visible during a refresh or after cancellation. Unknown provider outcomes still require reconciliation.

## Implementation and verification

- Existing workspace membership, roles, record scoping, leases, jobs and budgets are reused. No new dependencies, database migration or credential changes.
- Collection summaries read only the current snapshot identified by each research state, rather than loading all historical reports. This remains one read per collection and may need pagination for very large workspaces.
- New niche creation deduplicates equivalent scopes under the same admission lease. An unchanged save preserves its revision and cannot invalidate an equivalent queued job.
- Cross-account, private-workspace, outsider and revoked-membership checks passed with real local HTTP handlers and mocked research.
- Concurrent admission/duplicate-niche reuse, cancelled refresh reuse, topic bounds, invalid citations and duplicate topic rejection passed.
- Actual transpiled React component test verifies ten cards, no POST while opening a saved collection, and explicit refresh confirmation.
- Full local suite: **95 passed, zero failed/skipped**. TypeScript, production build and changed-file lint passed. Logs: `D:/AIReelsContent/validation/shared-research-full-tests.txt` and `shared-research-build.txt`.

Limitations: this change was verified with fixture research, not a new live LLM run or browser visual acceptance. Ten credible topics cannot be guaranteed for every niche/source window. Refresh currently performs one bounded research pass; it does not incrementally fetch only changed sources. Collections are shared within an authorized workspace, never globally across customers. No production readiness or publication approval is implied.
