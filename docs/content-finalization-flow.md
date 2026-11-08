# Evidence-based content finalization

Consultation policy: `editorial-text-v1` · Runtime policy version: `content-finalization-v1` · 8 November 2026 · Scope: AIReelsContent sourced text content packages. The runtime identifier maps to the consulted policy; it is not a second scoring standard.

Status: **APPROVED policy** by the Marketing Director (turn `01a1bb96-e3ee-7c80-a74f-a50984dabd1f`) and independent QA (turn `01a1bb97-abf9-74d3-a2ce-d56b1ba31e98`). Both explicitly found no essential policy blocker. This does not approve individual content, authorize deployment/publishing, certify software checks or establish rendered-media acceptance.

## Consultation evidence

The existing Marketing Director, SMM, ten social specialists and four production specialists were consulted individually, waiting for each to complete before dispatching the next. Exact responses, chat/turn IDs and timestamps are in [content-finalization-consultations.json](content-finalization-consultations.json). The initial audience acknowledgment is not an expert opinion; the substantive follow-up explicitly approves text-package policy. SMM's initial irrelevant old-heartbeat answer was corrected before continuing. Role recommendations concern process, not approval of real content, software or growth outcomes.

## Process and ownership

1. **Brief — Director/SMM.** Identify audience, objective, subject, brand, language, platform and outputs. Assign one owner and an independent noncontributor reviewer.
2. **Research — Market, Competitor, Audience, SEO.** Map material claims to actual source passages/IDs, publication date when shown, retrieval date and limitations. Check contradictions, expiry, eligibility and available recent content. Distinguish observed facts, inferred editorial angles, proposed experiments and unknowns. Product documentation supports feature facts, not audience demand. Search-language clarity belongs in relevance/clarity.
3. **Writing — Writer.** Produce accurate hooks, scope-preserving claims, readable sequence, requested variants and an appropriate next action. Preserve citations, uncertainty and labels for fiction/simulations. Never fabricate tests, reactions or results.
4. **Creative review — Creative and relevant production specialists.** Review the frozen text's promise, brand voice, originality against the available baseline, accessibility directions and brief fit. Originality never guarantees worldwide uniqueness. Sensitive-data solicitation and misleading demonstration instructions require revision.
5. **Independent review — assigned noncontributor.** Inspect all fields and claims, actual source support, rights, freshness, contradictions and promise alignment. Record seven human ratings with rationale and evidence. A creator cannot supply their own independent review. Record low ratings for revision; missing evidence never manufactures a score.
6. **Finalize text — owner/authorized editor.** Only a current exact-version independent review meeting all hard gates and thresholds may proceed to separate owner approval. Rating never supplies external-action authority. Approval, download, planner readiness and publishing checks must use the same server gate.
7. **Production handoff — separate acceptance.** Graphic/Carousel owns ordered carousel exports; Thumbnail owns packaging; Video Producer owns storyboard/shot packages; Video Editor owns assembled video. Require actual masters/exports, ordered hashes, rights/consent, truthful visuals, mobile readability, crop/contrast, captions/audio/playback and independent accessibility/QA as applicable. Text approval does not certify final media or native delivery.
8. **Publish and learn — Calendar/Community/Analytics.** Separately authorized account/version/timezone-bound execution requires dedup checks and provider readback. Check state before retrying uncertain results. Compare compatible platform/format/metric/window/post-age observations. Demand and performance stay UNKNOWN without actual evidence; ratings cannot establish causal lift.

## Rating filter

Seven required core dimensions: **relevance, originality, clarity, hook strength, brand fit, factual accuracy, CTA**, each 0–10. Each independent human rating needs a rationale of at least 20 characters and existing package evidence IDs. Source IDs make review traceable; they do not objectively prove creative quality or demand. Explain the relevant brief, brand/baseline and uncertainty in the rationale.

Eligibility requires unrounded mean **at least 8/10**, each dimension **at least 6/10**, factual accuracy **at least 8/10**, all existing claim/citation checks and hard gates. These thresholds derive from the Director's documented 0–5 rubric; they are editorial policy, not empirically calibrated growth predictors.

Anchors: 0–3 unusable/unsupported; 4–5 major revision; 6–7 adequate with improvements; 8–9 strong and supported; 10 exceptional with specific support. Missing evidence is UNRATED/REVIEW_REQUIRED, never zero or an invented 10. Never calculate a passing partial mean.

## Resolved differences

Several initial experts suggested N/A exclusion for individual assets or claim-free formats. The consolidated sourced-text-package policy requires all seven scores: a genuinely unassessable core criterion is REVIEW_REQUIRED and never shrinks the denominator. CTA rates fit of the intended action, including a justified deliberate no-CTA choice. Optional individual-asset criteria may be N/A with reasons outside the seven-score mean. Pure claim-free standalone fiction and rendered-only assets are outside this sourced-text rubric.

SEO proposed an eighth search-language criterion; incorporate it into relevance/clarity. Audience/Analytics require actual demand to remain UNKNOWN separately; relevance can reflect inferred brief-to-content fit. Product facts, competitor observations and copy scores never substitute for audience research.

Production specialists require actual rendered-asset acceptance. The tool's text approval/manifest explicitly excludes that acceptance; production gates remain necessary before media release. Their conditional recommendations are preserved, not rewritten as unanimous approval of a software implementation.

## Hard gates and versioning

Unsupported material claims, unresolved contradictions/rights, misleading promises/simulations, unsafe instructions, required evidence gaps and citation errors override scores. Final production defects block production acceptance; text review cannot certify them.

Independent review binds content/settings/evidence hash, reviewer, rubric version and expiry within 24 hours. Scores, rationales and source IDs remain with the review. The implemented hash covers the content/settings/evidence JSON: package revision or updatedAt alone is excluded, but evidence retrievedAt is included and changing it invalidates approval even if the excerpt is unchanged. Material changes invalidate the matching approval. Legacy approvals without this current review require re-review; saved drafts remain available.

## Verification and limits

Implementation owner reports 188/188 backend tests passing, production build and targeted lint passing. Actual-component browser checks used fixture API/auth at 1440, 768, 390 and 320 widths: unscored blocked, empty ratings, low scores saved and blocked, passing independent review followed by separate owner approval/download, expired review blocked, and no horizontal overflow. These are local fixture-backed checks, not live identity/production acceptance; the consultation coordinator did not independently rerun them. See [content-finalization-validation.md](content-finalization-validation.md) for the implementation owner's checks and limits.

No deployment, live approval/publication, spend or real-media acceptance is established. Human ratings remain subjective; policy approval and passing software checks are separate evidence.
