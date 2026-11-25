# ScholarGrid web app

Next.js 15 (App Router) + TypeScript + Tailwind CSS 4 + TanStack Query 5. Talks to the FastAPI backend
(`python -m scholargrid.api`) through a same-origin proxy: `/api/*` is rewritten to `SCHOLARGRID_API_URL`
(default `http://127.0.0.1:8000`).

```bash
npm install
npm run dev          # http://localhost:3000 (start the API first)
npm run typecheck
npm run build && npm start
npm run gen:api      # regenerate src/lib/api-types.ts from openapi.json
```

After changing API schemas: `python -m scholargrid.api --openapi web/openapi.json` (from the repo root), then
`npm run gen:api`. CI fails if the committed types are out of date.

## Layout

| Path | What |
|---|---|
| `src/app/` | routes: `/` start, `/search`, `/paper?id=`, `/topic?q=&tab=`, `/plan`, `/ask`, `/projects`, `/projects/[id]`, `/map`, `/areas`, `/areas/[id]`, `/trends`, `/about`, `/settings`, `/evaluate` |
| `src/components/ui.tsx` | primitives: buttons, inputs, tags, callouts, empty/error states, skeletons, job progress |
| `src/components/{paper,gap,reading,plan,charts}.tsx` | domain components (paper rows, open-problem cards, reading paths, plan view, single-series SVG charts) |
| `src/components/map/` | Sigma.js research map (ported from the Streamlit explorer) |
| `src/lib/api.ts`, `types.ts`, `api-types.ts` | typed client; types generated from the OpenAPI schema |
| `src/lib/hooks.ts` | status polling, background-job following (`useBuild`) |
| `src/lib/project.tsx` | the active project (where Save goes), toasts |

## Design

Graph-paper surfaces, fountain-pen ink and a highlighter: verified evidence quotes and matched search terms are
literally highlighted. Newsreader (serif) for questions, titles and reading text; Schibsted Grotesk for the UI.
Tokens live in `src/app/globals.css` (light and dark).
