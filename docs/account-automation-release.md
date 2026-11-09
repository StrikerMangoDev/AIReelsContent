# Account automation release

The owner authorized unattended research, content creation, media rendering and publication to the five connected Postiz accounts. Each account has its own audience, voice, weekly brief and content pillars. Initial cadence is three weekly posts, with date-supported daily news filling remaining days, capped at one post per account per day in Asia/Calcutta. The scheduler runs daily at 01:00 UTC.

## Release policy

Account automation uses explicit owner consent and a separate machine-review policy. It never writes human editorial approval. Deterministic evidence checks precede a separate model review; current profile, exact content, citations and actual stored media bytes are checked again before publication. Unsupported or uncertain work is held with a visible stage status. A provider queue is not proof of delivery, and uncertain dispatch is never blindly retried.

Durable stages continue across serverless invocations. Weekly research can reuse a matching current report; news requires current or previous-day source-supported dates. Public captions include actual cited HTTPS source URLs. Platform limits are checked without truncating reviewed text.

The local renderer produces original branded PNG cards and silent captioned H.264 MP4s. Instagram and YouTube use MP4. Rendering includes full decode checks; this is technical verification, not human viewing or factual certainty. Narration, paid video models and guaranteed engagement are outside this release. Recurring paid budget remains zero; the owner's $5 permission applies only to the one demonstration.

## Validation

Independent clean-environment validation passed 230 tests, the production frontend build and targeted lint. See local validation/phase4-independent-tests.log and validation/phase4-independent-build.log. These checks do not establish deployed native rendering or social delivery. Live acceptance results must be recorded separately after deployment.

Production configuration uses server-only Vercel secrets and an owner-scoped account allowlist. Never copy credentials into this document, browser code, logs or source control.
