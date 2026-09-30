# Signal AI

Public AI and technology intelligence feed. React/TypeScript frontend, Node.js API, local SQLite or production Supabase persistence, Firebase authentication, and a separate Vertex Gemini ingestion worker.

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

Article cards redirect directly to original publishers. Country/topic/search filters use the API; map activity counts unique monitored articles published today in the viewer's timezone. No login or admin panel is included.

See [engine architecture and operations](docs/ENGINE.md) for folder ownership, prompt behavior, source configuration, cost controls, API/deployment boundaries, and migration guidance.

Core configuration: `server/config/sources.js`, `server/config/env.js`, `.env.example`.
Editorial prompt: `server/prompts/news-curator.md`.

This engine grounds Gemini in RSS/Atom title/excerpt evidence. It does not provision Vertex AI Search/Agent Builder crawling resources or infer the project's remaining credits from its service-account JSON.
