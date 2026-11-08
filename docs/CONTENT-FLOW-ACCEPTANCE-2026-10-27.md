# Local content flow acceptance — 27 October 2026

Status: generation and reviewer handoff verified; live human approval and export pending.

## Live browser checks

1. Signed into the existing author account through Hexclave; selected a saved AI topic and created a draft without changing category records.
2. A headline-only AI source correctly blocked generation, but provided no recovery path. Added a guarded original-source intake on ungenerated drafts, with a matching UI prompt. Verified successful retrieval of the Cornell Chronicle original article into draft `3bd4aeb80b296c607e949f6e311803bc`, preserving research context. The initial OpenAI article was not readable by the safe fetcher; its draft remains untouched.
3. Confirmed all-format AI generation. Job `db8cdbba-d237-4f5b-9eb7-8bd4e794992a` returned MODEL_INCOMPLETE with generation ID `gen-1793082225-Mgrb1JIGfkh71hTD2CGD`. The provider's upstream log shows HTTP 200 but the generation receipt endpoint returns 404. Completion is not established. The job remains dispatch_unknown, with no replay, reset or fabricated result.
4. Selected a separate astrology topic and explicitly saved script/captions only. Job `e069041b-d476-46eb-8635-de41c4fce28b` completed. Draft `c6c2b5c3905df9fa0d4777038999e245` contains narration, hooks, captions and four attributed claims.
5. Reviewed generated wording, removed unsupported statements about individual sign assignments and shareability through the normal editor, and saved a new revision. Citation checks pass. Evidence remains a news-feed headline; the copy now makes that limitation explicit.
6. Assigned the different, signed-in reviewer account. Verified the reviewer page displays revision 6, claims, source references and unchecked attestations. No human review was fabricated. Author approval and exports remain disabled until review is recorded.

## Code repairs and checks

- Separate loopback-only LOCAL_GENERATION_DISPATCH flag dispatches newly confirmed ready jobs. No backlog drain, scheduler, paid fallback or production enablement.
- Original-source intake enforces ownership/write access, expected revision, ungenerated state, no library mapping, twelve-source cap, duplicate URL rejection and safe retrieval. Existing evidence/context persist; approvals clear. UI eligibility matches these guards.
- Safe numeric provider error and transport status diagnostics are retained without raw error messages or private metadata. Retry and unknown-outcome policies are unchanged.
- Terminal polling clears the stale queued notice.
- 128 regression tests pass. Review/export tests exercise exact-version approval, self-review rejection, revoked reviewer rejection and successful fixture export. Type check, local build and changed-file lint pass.
- Senior developer reviewed the source-recovery UI and its regression. Parent independently reviewed the delegated backend changes and ran the complete suite. This code review is not a substitute for human source/content approval.
- Existing OpenRouter test key reports spending limit 0 and usage 0 after live attempts. This account-level observation does not reconcile the uncertain AI generation receipt.

## Remaining acceptance

The user chose to perform the independent human review. Await that review, then test owner approval, Markdown download and production JSON export against the reviewed hash. Do not claim end-to-end completion until those live checks pass. The full-format AI attempt remains unresolved with the provider; astrology's smaller scope does not prove all-format reliability.

No deployment, push, paid service enablement, production cloud mutation or social publishing occurred.

Artifacts under `D:/AIReelsContent/validation`: `content-flow-tests.txt`, `content-flow-build.txt`, `content-flow-live-status.json`, `content-review-handoff.png`.

## Follow-up full-flow test

- Tested the active astrology draft `f503b31c06fec6f688a88cab94e8fa48`, selected script/captions for Facebook/Instagram, confirmed a live free-model generation, and observed successful completion at revision 4.
- Editorial inspection found narration incorrectly grouped USA Today's daily horoscope as weekly even though claim C4 correctly said daily. Unsupported outlet classifications and general astrology-method assertions also appeared. The draft was not approved.
- Strengthened generation instructions: research summaries/previous drafts are untrusted editorial leads; every cited sentence must preserve its claim's source-specific period, date and scope; domain names do not establish publisher classifications or mechanisms. This is mitigation, not semantic validation.
- A normal confirmed revision completed at revision 6 and corrected daily versus weekly coverage. Unsupported divergence wording persisted; removed it through the normal editor in narration and captions, saved revision 7. Citation checks passed; human review remains absent and export controls remain disabled. No human attestations were entered by the agent.
- Senior developer found and fixed unbounded content/research status polling and review reads. Saved GETs now use bounded reads. Recovery clears only the relevant prior polling error. Mutation dispatch remains unchanged. Parent reviewed the integration and identified the stale-error follow-up; senior reviewed the parent's download regression test.
- All 138 regression tests passed. Lint, TypeScript and build passed for the application changes; the final added download test also passed targeted lint. Five-platform fixture journeys verify review/approval/export permissions, expiry, revocation and changed-source rejection. Actual UI download function plus Markdown formatter tests prove server-snapshot JSON/Markdown creation and no file creation after server denial. These are fixtures, not a physical live browser export.
- OpenRouter key status after both live calls: limit 0, usage 0. No deployment, paid enablement or production mutation. The previous uncertain AI job was not replayed.

Decision: technical workflow checks pass; live approved export remains NOT VERIFIED. The user delegated the editorial decision, and the agent kept approval withheld rather than impersonating a human reviewer. Headline-only evidence and remaining model semantic unreliability prevent claiming publication readiness.

Screenshot: `D:/AIReelsContent/validation/content-flow-corrected-2026-10-27.png`.
