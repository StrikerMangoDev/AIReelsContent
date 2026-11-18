# OpenAI migration ledger — 18 November 2026

## Authorization and scope
User selected reuse of the existing Mango Tree key and asked for complete implementation and deployment. Base origin/main ceeb8a3 preserves the November 15 Find ideas and backend login release. Replace Gemini text with GPT-6 Luna; retain data, auth, UI brand, exports, evidence checks, question/goal checks and the existing global $5 ledger. No budget increase, media-provider substitution or prompt rewrite.

## Integration and approved stages
1. Direct Responses HTTP through the existing generateJson signature; strict schemas and unchanged server validation. Authenticated HTTP and worker operation scopes supply the existing monetary repository/owner. No missing-context dispatch. Preserve OpenRouter compatibility but do not fall back to it or Gemini when OpenAI is selected. Disable old explicit Gemini demo routes. Free-only unattended automation remains blocked from paid calls.
2. Focused/integration tests, complete suite, real source-backed generation, exports, production env switch, Git push and Vercel deployment. Both stages authorized together.

## Key and credit
User-selected Teams key matches the masked APIContent key in Mango Tree Technology LLP/Mango Tree Project. Parent chat independently verified the grant in the same organization on November 18. Never record the secret. Earlier exposure remains a rotation risk. Credit is not treated as a pricing discount or as permission to exceed $5. No local plaintext key file is needed.

## Model, transport and privacy
gpt-6-luna, standard processing, reasoning none (existing adapter disabled reasoning), medium/default verbosity, store:false, existing output bounds. Single bounded stateless HTTP calls; no network retries. Incomplete/refused/error output rejected. Missing usage or transport uncertainty retains the reservation. Cached/input/output usage accounted at verified rates. store:false does not establish Zero Data Retention. No new residency claim.

## Research
Keep Google News RSS and safe passage retrieval/fallback. OpenAI analyzes actual retrieved evidence. Luna supports web search, but native search is not enabled because it adds charges and changes ingestion/citation handling. Original evidence validation remains mandatory.

## Capability assessment
Each heading of responses-api-guidance.md assessed below before implementation.

## Verification
Pending: update with actual commands, counts, provider receipts and deployment evidence before handoff.

Official sources: https://developers.openai.com/api/docs/models/gpt-6-luna ; https://developers.openai.com/api/docs/guides/structured-outputs ; https://developers.openai.com/api/docs/guides/tools-web-search ; https://developers.openai.com/api/docs/pricing
- Model Selection: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Instruction File Naming: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Migrate from Chat Completions to the Responses API: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Streaming: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- WebSocket Mode: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Data Privacy and Residency: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Zero Data Retention: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Data Residency: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Processing Tiers: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Prompt Caching: Automatic caching only; no new keys/writes/retention. Preserve cached-token accounting.
- Prompt Cache Keys: Automatic caching only; no new keys/writes/retention. Preserve cached-token accounting.
- Extended Cache Retention for Earlier Models: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Explicit Cache Breakpoints for GPT-5.6 and Later: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Prompt Cache Diagnostics: Automatic caching only; no new keys/writes/retention. Preserve cached-token accounting.
- State Management: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Instruction Persistence Gotcha: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Reasoning: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Encrypted Reasoning Items: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Reasoning Effort: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Reasoning Preservation: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Reasoning Summaries and Tool-Call Preambles: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Verbosity: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Maximum Output Tokens: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Assistant Message Phases: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Context Compaction: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Structured Outputs: Applicable: implement or preserve as specified in the controls above; verified official Responses/Luna documentation.
- Tools: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Tool Choice: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Tool Search and Additional Tools: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Parallel Tool Calls: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Programmatic Tool Calling: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.
- Model-Aligned Tool Interfaces: Not required for bounded stateless JSON calls; preserve behavior. No new streaming, connection, tool execution or replay.

## Validation update
Real Anthropic evidence -> GPT-6 Luna writer and separate intent evaluator succeeded; four claims, zero citation issues, alignment passed. Usage included 30-minute cache writes; complete input/read/30m-write/12h-write rates are now covered. Source/input byte bound 200000 plus 4096 allowance stays below 272K long-context pricing. Test recorded 1622 microUSD in the existing production ledger; no cap change. OpenAI quote authority expires with the currently verified benefit at 2026-12-16T18:39:18Z; fresh pricing/benefit review required before extending it.
Full-suite baseline exposed a stale November 15 auth mock and an unused old Vertex fixture; corrected only the fixtures. Updated recovery-button test to its provider-neutral label; retained its acknowledgment and no-dispatch checks.
Read-only free-provider receipt lookup remains read-only under OpenAI; added explicit regression test.

## Completed checks before deployment
- Complete suite: 579 passed, zero failed. Focused OpenAI tests: 10 passed (HTTP auth/owner isolation, cached reads/writes, short-context bounds, invalid/incomplete output, missing usage, no network retries, Gemini dispatch guards and historical read-only receipts).
- Real research: 12 retrieved sources, one supported focused opportunity. Real generation: 4 source-bound claims, zero citation issues, separate question/goal evaluator passed. Production ledger settlements: 1622 + 1547 microUSD; existing global/owner limits and old holds unchanged.
- Built all six export formats from actual generated content: MD, JSON, TXT, HTML, DOCX and ZIP; no empty files. No browser click/download claim from this artifact check.
- Multi-platform oneOf grammar maps to anyOf while unchanged Zod validates the discriminated union. Optional-field restoration covered.
- Lint and production build passed. November 15 UI/auth code preserved. Only provider-aware explanatory copy changed; no layout, style, auth, schema/data migration or dependency changes.
- Production Secret and model/org/project configuration prepared; active provider selection is OpenAI and Vertex fallback was already false. Deployment and signed-in browser acceptance pending.
- Current Chrome session is signed out after the November 15 backend login change; do not claim signed-in live generation until an authorized session is available.
