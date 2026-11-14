# Strategy alignment — local implementation, 14 November 2026

The content-generation path now checks the selected question and goal separately from citation/JSON validation. Existing public text that merely repeats a related announcement is not accepted as an answer.

## Changes

- `content-alignment.js` builds an editorial contract from the saved goal, selected candidate and its linked audience question(s). A configured workflow with a missing goal, mismatched KPI or broken question reference is rejected before admission. Website SEO needs an objective, primary intent/keyword, research and outline before writing.
- The basic topic/draft path receives a clearly labelled explanatory default question/goal when no strategy is configured. This is an editorial hypothesis, not observed audience demand or an invented business objective. The full expert workflow and external research remain distinct.
- The writer receives the contract on the first attempt and every correction. Source-bound repair retains selected questions, goal and the SEO outline rather than dropping them.
- A separate free-provider evaluator checks each delivered post, script, caption and website body against the relevant question, goal/CTA, opening promise and intent. Returned answer quotations must occur in the actual public text. Missing, duplicate, unknown or incomplete judgments cannot pass. An honest source-limited response must address the specific question; generic disclaimers cannot rescue off-topic copy.
- Writing and correction remain bounded to two attempts. Evaluation uses the allowed zero-price NVIDIA provider and the same operation's permission/budget checks; no paid evaluator fallback was added. A provider timeout remains an uncertain outcome. No independent human approval is fabricated.
- The saved assessment binds to canonical content and contract hashes, so JSONB key reordering is harmless. Edits or changed strategy cannot reuse an old pass for export/publication. Generation confirmation also binds to the context revision.
- X generation schemas enforce concise draft bodies before persistence; final weighted-character/source-link validation remains unchanged. Nothing truncates saved copy to manufacture a pass.
- Public research intake scores at most three eligible questions, then selects the highest supported editorial priority instead of blindly choosing the first. Explicit owner selections remain intact. This is a bounded candidate pool, not an exhaustive topic ranking.

## Actual free-provider acceptance

Source: real saved production package `2616c2ac7f64ad36605200a0560656c3`, copied into isolated local memory. No production records were written.

1. Negative case: the actual saved X/website copy about coding improvements was rejected for failing to address its selected research-restriction question. The available selected quotation cannot answer that question. No unsupported answer was inserted, and the old draft was preserved during rejected attempts.
2. Positive case: a separately labelled local editorial-hypothesis question asked which organizations can apply for Mythos and through which programs. It used the actual captured publisher article, a matching explanatory objective, and no fabricated audience observations. Real free-model generation answered the question on both X and website, and separate semantic assessment plus existing citation checks passed.
3. The final successful run used `nvidia/nemotron-3.5-super-vl:free`, three provider calls (negative assessment, positive writing, positive assessment). Prompt/completion catalogue prices were checked as zero and provider max-price-zero constraints remained enabled. This is not a Google billing/credit receipt.
4. Test database spend authorization was $0; Vertex, publishing, scheduling and account automation were disabled. The production $5 limit was not changed.

Detailed receipt and actual output: `D:/AIReelsContent/validation/strategy-gap-real-free-receipt-20261114.json`.

## Verification and limits

The full existing suite, new real-record regression cases, source/ownership/export guards and build were checked locally. Dated test logs under `validation` contain exact final totals. One pre-existing isolated browser-fixture lint warning remains; no new lint error was introduced.

An automated semantic assessment remains fallible, not proof of truth or performance. The original unsupported question still needs better source evidence to produce a substantive answer. CMS, Search Console, GA4, paid keyword/competitor data and a verified published/measurement cycle remain unconnected or pending; this patch does not enable or simulate them.

## Signed-in Chrome acceptance and repairs

On 14 November, actual local free-model browser generation passed for these saved records:

- AI package `1ce5611f9674588b8a42a7b94deb7db4`, revision 12: an explicitly selected editorial-hypothesis question asks why matching data does not establish scientific understanding. The Facebook post and both caption alternatives answer it using the saved Anthropic article. Each delivered target passed the separate semantic assessment and citation validation.
- Astrology package `39a623969b5f28a909ba5ce7178fe4ee`, revision 9: the selected CHANI beginner explainer produced six carousel scenes and captions, attributing astrological interpretations and avoiding guaranteed personal outcomes. Its explanatory contract is an editorial default from the selected research idea, not observed audience demand. Script and both captions passed semantic assessment; citation issues were empty.
- Desktop previews, carousel next-slide/editor synchronization, copying actual slide text and Markdown downloads were exercised. Both downloaded files retain sources and claim provenance. Narrow-screen editor/preview switching, carousel navigation, copy and actual downloads were also checked in the signed-in app in a 390 by 844 CSS iframe (about 375 pixels of content after the scrollbar). Chrome's viewport-override API did not resize the tab, so it was not counted as mobile proof. No physical device was tested.
- Rejected drafts exposed repairs: semantic correction can select from the original evidence instead of being locked to an off-topic first draft; evaluator answer quotations must be exact short contiguous text; editorial-question source links are visibly required; server field errors are shown; a rejected generation has an explicit retry action. A terminal malformed multi-tool result receives one shared correction using the native JSON mode, never a merged set of ambiguous submissions. Confirmed free-provider HTTP 404/422 routing rejections can be manually recovered while every uncertain budget hold is retained. Transport timeouts and ambiguous outcomes still do not automatically retry.
- Empty/unconfigured strategy containers and platforms without an account strategy now receive the labelled explanatory default instead of silently bypassing assessment. Explicit selected account strategies are preserved.
- Temporary download activity no longer labels an otherwise valid saved draft as needing content checks. Export still rechecks saved content, ownership, workspace, citations and strategy freshness.

The browser generated writing and layout previews, not finished images, audio or video. No social post was sent. No paid service, credential or spending limit was changed. Release-specific build, test and deployment receipts are stored outside the published source under the project validation folder.
