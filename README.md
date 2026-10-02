# Signal AI

Research and content desk for any niche, with a public AI/technology feed. Prompt-led web research produces major updates, sourced audience observations and platform-specific production briefs for LinkedIn, Instagram and YouTube. React/TypeScript frontend, Node.js API, SQLite or Supabase, Firebase and Vertex Gemini.

See [the product workflow, agent contracts, setup and limitations](docs/CONTENT_PRODUCT.md). The research desk is `/`, the existing AI feed is `/dashboard`, and saved content is `/studio`.

See [production setup](DEPLOYMENT.md) for cloud configuration, migration, secrets and deployment checks. Live cloud authentication and Supabase integration still require the real project configuration.

## Start

Requires Node.js 24+.

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on port 3001. Set the server-only credential path in `.env` if needed; the existing ignored `vertex.json` is the default. Never expose the credential through frontend code.

```sh
npm run ingest       # fetch and curate one bounded batch
npm run worker       # scheduled refresh; requires ENABLE_SCHEDULER=true
npm test
npm run lint
npm run build
```

Article cards open a source summary with a creation action; original-source links redirect to publishers. Country/topic/search filters use the API; map activity counts unique monitored articles. Private research/content workspaces require configured Firebase authentication. Website publication is administrator-only.

See [engine architecture and operations](docs/ENGINE.md) for folder ownership, prompt behavior, source configuration, cost controls, API/deployment boundaries, and migration guidance.

Core configuration: `server/config/sources.js`, `server/config/env.js`, `.env.example`.
Editorial prompt: `server/prompts/news-curator.md`.

This engine grounds Gemini in RSS/Atom title/excerpt evidence. It does not provision Vertex AI Search/Agent Builder crawling resources or infer the project's remaining credits from its service-account JSON.
