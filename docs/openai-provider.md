# OpenAI text provider

Manual idea assistance, category research, content writing, question/goal checks and production analysis use the existing `generateJson` contract through OpenAI Responses when `CONTENT_TEXT_PROVIDER=openai`.

Server configuration:

```dotenv
CONTENT_TEXT_PROVIDER=openai
OPENAI_MODEL=gpt-6-luna
LLM_MODEL=gpt-6-luna
CONTENT_VERTEX_FALLBACK=false
# OPENAI_API_KEY: Vercel server Secret; never a VITE_/public variable.
# OPENAI_ORGANIZATION_ID / OPENAI_PROJECT_ID: match the approved key/grant.
```

The existing generation capability switch and daily admission limit still apply. Every paid model call additionally reserves and settles against the authenticated owner's existing monetary ledger and global cap. Deployment does not configure, reset or raise either cap. Missing permission, budget or operation context blocks inference. Timeouts and missing usage retain their holds. No network retries or Gemini fallbacks are performed.

Standard Luna pricing verified 18 November 2026: per million tokens, input $0.10, cached reads $0.01, 30-minute writes $0.125, 12-hour writes $0.25, output $0.50. Reservations use the highest write rate and full output allowance. Serialized input is limited to 200000 bytes plus a conservative 4096-token framing allowance, below the 272K input-token long-context threshold. The verified benefit/pricing authority expires 16 December 2026 at 18:39:18 UTC; refresh it explicitly before extending paid inference.

`store:false` avoids storing Responses for later retrieval; it does not establish Zero Data Retention or regional residency. Buffered strict JSON is required because drafts must pass complete schema, evidence, quotation and audience-goal checks before saving. Optional schema fields map to nullable grammar fields and are restored before the unchanged application validation.

Research retains existing Google News RSS and safe passage retrieval. Native OpenAI web search is not enabled. Image/video/local rendering are not replaced by a text model. Existing free-only scheduled automation does not receive paid permission from this migration; it remains blocked from OpenAI until separately authorized. Old Vertex/OpenRouter Gemini demonstration dispatch is disabled under OpenAI selection; historical records and free-provider receipt reads remain available.

The user-selected key was previously exposed and should be rotated. Production stores it as a server Secret. Do not copy it into source, exports, chat or browser configuration.

Sources: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [pricing](https://developers.openai.com/api/docs/pricing), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
