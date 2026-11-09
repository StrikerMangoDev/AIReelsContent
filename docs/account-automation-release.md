# Account automation release

The owner authorized unattended research, content creation, media rendering and publication to the five connected Postiz accounts. Each account has its own audience, voice, weekly brief and content pillars. Initial cadence is three weekly posts, with date-supported daily news filling remaining days, capped at one post per account per day in Asia/Calcutta. The scheduler runs daily at 01:00 UTC.

## Release policy

Account automation uses explicit owner consent and a separate machine-review policy. It never writes human editorial approval. Deterministic evidence checks precede a separate model review; current profile, exact content, citations and actual stored media bytes are checked again before publication. Unsupported or uncertain work is held with a visible stage status. A provider queue is not proof of delivery, and uncertain dispatch is never blindly retried.

Durable stages continue across serverless invocations. Weekly research can reuse a matching current report; news requires current or previous-day source-supported dates. Public captions include actual cited HTTPS source URLs. Platform limits are checked without truncating reviewed text.

The local renderer produces original branded PNG cards and silent captioned H.264 MP4s. Instagram and YouTube use MP4. Rendering includes full decode checks; this is technical verification, not human viewing or factual certainty. Narration, paid video models and guaranteed engagement are outside this release. Recurring paid budget remains zero; the owner's $5 permission applies only to the one demonstration.

## Validation

Independent clean-environment validation passed 230 tests, the production frontend build and targeted lint. See local validation/phase4-independent-tests.log and validation/phase4-independent-build.log. These checks do not establish deployed native rendering or social delivery. Live acceptance results must be recorded separately after deployment.

Live native-render acceptance on 9 November 2026 used the existing AI scientific-modeling draft `52ebdbf0e4262e6ab13d670638e568ce`. PNG asset `94f75574-3bd8-aacd-06d8-b8154851cef4` passed at 1080x1920. MP4 asset `49fdfbde-4cb7-ddd3-05b9-b6646df9a8bc` passed full decode at 18 seconds/432 frames, played in Studio, and downloaded successfully. Its 464731 downloaded bytes matched SHA-256 `e3ff1420a24f379a1ed5607951981e8ba8c0e24ce459aba7ee6417d25d942cdb`. This validates rendering and private delivery, not text release or social publication.

The real account demonstration exposed shared research admission contention and rolling quota exhaustion; these are distinct from provider timeouts. Admission contention now has a bounded pre-dispatch wait. Production allows 20 free research/writing admissions per rolling 24 hours while preserving the one-post account cap and zero recurring paid ceiling. Supported free model configuration was changed after provider timeouts. Original uncertain job records remain intact; see `free-text-replacement.md` for the bounded replacement policy. No human approval or delivery receipt is inferred from these changes.

Independent validation of the bounded replacement release passed 242 tests on Node 24 in a clean test environment; targeted lint also passed.

Production configuration uses server-only Vercel secrets and an owner-scoped account allowlist. Never copy credentials into this document, browser code, logs or source control.
