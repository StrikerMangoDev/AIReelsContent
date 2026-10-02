# Signal research and content desk

## Customer workflow

1. Open `/`, name any niche, and describe the audience and developments to follow. Source URLs are optional: the primary flow researches the public web.
2. Optionally choose a market, English/Hindi/Hinglish, male/female voice, delivery and target duration. Auto means a reasoned starting recommendation, not measured superiority.
3. Research produces a dated snapshot: major changes, source references, benefits, criticism, qualitative public reactions, uncertainties and content angles.
4. Select an opportunity. The app creates and checks a complete LinkedIn, Instagram and YouTube package without separate source approval or manual review jobs.
5. Review the platform previews. Request changes in plain language, inspect sources if needed, and approve the content.
6. Download a readable team brief or the full production JSON. Generate a voiceover with the selected voice and delivery. Export a captioned vertical WebM draft, or use scene prompts with the image/clip tools or an external editor.

The existing AI publisher feed remains at `/dashboard`. It is not mislabeled as broad social trend measurement. The source library, revision history, source refresh and administrator website publishing remain available.

## What the agent returns

The executable contracts are `nicheSchema` and `intelligenceSchema` in `server/studio/intelligence.js`, and `strategySchema` / `contentSchema` in `server/studio/content.js`. The shared agent instructions live in `server/prompts/social-manager.md`.

Each opportunity includes:

- What changed, event date when supported, verification status, why the audience should care and evidence IDs.
- Supported positive and negative observations, each with sources.
- Observed public reaction, explicit sampling limitations, and an insufficient-evidence state. It does not report majority sentiment without population data.
- An editorial angle, hook, counterpoint, suggested keywords and a reason the idea is worth testing.

Each production package includes:

- Three initial hooks; narration; timed scene plan, on-screen text, visual prompts and voice directions.
- Language, voice and delivery recommendations with reasons.
- One adaptation each for LinkedIn, Instagram and YouTube: headline, hook, body/caption, CTA, hashtags, cover direction, format, retention plan, alternate hook and test plan.
- Video/audio prompts, subtitle style, music direction and editing notes.
- Experiments with a variable, two variants, metric and decision rule.
- Claims, evidence, review status, revision and the originating research brief.

The JSON download preserves citations and structured fields. The readable team export removes citation markers from publishable copy and appends evidence separately. Generated content is not automatically posted to external accounts.

## Evidence and product boundaries

Research uses Google Search grounding with the existing Vertex client, then a separate structured synthesis call. This avoids relying on models to invent source URLs. Up to six originals are fetched through the existing public-HTTPS intake protections. If an original cannot be retrieved, search-grounded model passages are explicitly labeled as summaries, not publisher quotations. No grounded sources means a failed briefing, with old reports retained.

Source-link validation and quotation/citation checks are implemented. They do not independently prove truth, full claim coverage, audience representativeness or platform performance. The agent challenges dubious premises such as a product being "almost AGI" instead of treating the prompt as proof. Event dates and reactions still require human judgment for important publication decisions.

Viral potential, keyword demand, language performance and voice performance are hypotheses, not scores or guarantees. This product currently has no connected social engagement dataset and no automatic Instagram, YouTube or LinkedIn publishing. Team exports are the delivery path. Website publication remains administrator-only.

The native video export is a narrated text-scene draft, not a cinematic edit. It follows the actual audio duration, uses estimated word-weighted caption timings, and exports WebM plus SRT. Keep the browser tab visible during export. Exact speech alignment, licensed footage/music, MP4 transcoding and external social publishing are not implemented. An individual generated video asset is honestly labeled as an eight-second illustrative clip.

Manual narration edits are saved as a draft and synchronized with scenes and platform copy using the generation allowance. Approval and video rendering reject mismatched scene narration. Interrupted content jobs expose a retry after two minutes. Media retries preserve their original request identity across reloads and reconcile saved assets before starting another paid request. Browser session storage must be available for this protection.

Research history loads 20 lightweight entries at a time, with older-page access. Full evidence is retrieved only when a briefing is selected. Both database adapters enforce owner scope for history and report detail.

## Daily niche agents

Enable `STUDIO_RESEARCH_SCHEDULER=true` on the API and run `npm run research:worker` in a persistent Node 24 process using the same database and provider configuration. Users opt in per niche and can save or pause the preference without running new research. A configured flag alone does not start a worker.

The worker checks for due niches each minute, processes one at a time, and attempts each opted-in niche at most once per rolling 24 hours. Owner and worker leases avoid overlap. Failed attempts are visible in the research desk and preserve prior reports. Each account has a shared manual/automatic allowance of ten research requests per rolling 24 hours; each successful research request uses two model calls plus search. This is separate from the existing feed curation and content/media quotas.

For Supabase, apply `004_niche_research.sql` after migrations 001–003. Its cross-owner due-niche query is restricted to the server service role. Vercel web functions do not run the persistent worker: deploy it on a worker host, or invoke `node server/research-worker.js --once` from your own trusted scheduler. One `--once` invocation processes one due niche. Size scheduler frequency to your number of opted-in niches.

## Configuration and acceptance

- Node 24 or newer; the default machine Node 20 cannot run this repository's SQLite tests.
- Firebase web and server configuration for real sign-in.
- Vertex project and server-side credentials, a model supporting Google Search grounding, and enabled/billed API access.
- For media, the existing supported model IDs, per-generation cost estimates, and private Supabase media bucket in production.
- No credentials are included, copied into the browser, or bypassed by a demo sign-in.

Before release, verify a real account and a live research request for each representative niche, then listen to English, Hindi and Hinglish voiceovers and review a full exported video. Network/provider tests use injected fixtures; passing them does not certify live provider output quality. Measure research-to-package conversion, package exports/approvals, repeated use, actual review time and provider cost. Studio events respect the existing analytics-consent choice.

## Suggested initial brief

"Follow major AI launches and research from the past week for Indian small-business owners. Verify company/product names and capability claims. Explain practical benefits and credible concerns. Look for public reactions but label missing or unrepresentative evidence. Suggest honest, high-retention ideas for Instagram Reels, YouTube Shorts and LinkedIn. Use conversational Hinglish, a calm voice and a 45-second target. Include alternate hooks and tell the team what to test."

For another genre, replace the niche and audience rather than changing the system prompt. Public research cannot discover private offers, unpublished facts or exact brand preferences: supply those in the brief.
