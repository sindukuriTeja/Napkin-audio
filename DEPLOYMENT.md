# Deploying Napkin Audio AI Studio

There are two ways to deploy this app. Pick one:

- **Option A — all-in-one on Vercel** (recommended if you just want it live on Vercel with no second host). The frontend and the provider proxy deploy together as one Vercel project: the Vite app builds as static output, and `api/[...path].js` turns the proxy into Vercel serverless functions. See "Option A" below.
- **Option B — frontend and backend on separate hosts.** The Vite/React frontend (`npm run build` → static files) deploys to any static host (Vercel, Netlify, etc.), and `server/provider-proxy.mjs` — a small always-on Node process — deploys separately to a host that runs persistent Node processes (Render, Railway, Fly.io). This is the better fit if you outgrow Vercel's serverless limits (see the caveats in Option A) or want the backend on its own infrastructure. See "Option B" below.

Both options share the same route-handling code (`server/provider-proxy.mjs`), so behavior is identical either way.

Never put `ELEVENLABS_API_KEY` in the frontend or a `VITE_`-prefixed variable — only the backend needs it, and Vite bakes `VITE_` variables into the public JS bundle.

## 0. Push the code to GitHub

Most static/Node hosts deploy from a Git repo. From the project folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.env` is already listed in `.gitignore`, so your real ElevenLabs key won't be pushed. Double-check with `git status` before your first commit if you want to be extra sure.

## Option A: all-in-one on Vercel

1. Push the repo to GitHub (above), then in Vercel: New Project → import the repo. Vercel auto-detects the Vite framework preset (build command `npm run build`, output directory `dist`) and separately picks up everything under `api/` as serverless functions — no extra config needed for either.
2. In the Vercel project's Settings → Environment Variables, add the backend variables directly (not `VITE_`-prefixed, since these stay server-side in the serverless functions): `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, and optionally `OLLAMA_BASE_URL` / `OLLAMA_MODEL` (see the Ollama caveat in step 4 below — it won't be reachable from Vercel regardless of these settings).
3. Deploy. Because the frontend and the `/api/*` functions are served from the same domain, there's nothing else to wire up: `providerProxyBaseUrl` in `src/services/providerProxy.ts` resolves to a same-origin relative path (`""`) automatically in a production build, and no `CORS_ORIGIN` configuration is needed.
4. Redeploy any time you change an environment variable (Vercel doesn't hot-reload function env vars into a running deployment).

Caveats specific to this option:
- **Function duration.** `api/[...path].js` sets `maxDuration: 60` for ElevenLabs full-spot rendering (which calls the API once per script line, sequentially). Vercel's Hobby plan may cap actual duration lower than that regardless of what's configured — check your plan's limits if a full-spot render on a long script times out.
- **Request body size.** Vercel serverless functions have a request body size limit (a few MB) that a persistent Node server doesn't have. This mostly matters for the VO Voice Transformer's source-audio upload (`/api/voice/elevenlabs/voice-changer`) — a long or high-bitrate recording could exceed it. If that becomes a real constraint, switch that route to Option B's backend host instead.
- **Ollama/Llama 3 still won't work**, for the same reason it wouldn't work on any serverless host — see step 4 in Option B below. This is unrelated to Vercel specifically.

If either caveat becomes a real problem, moving to Option B only requires setting `VITE_PROVIDER_PROXY_URL` and redeploying the frontend — the route logic doesn't change.

## Option B: frontend and backend on separate hosts

### 1. Deploy the backend (provider-proxy) first

Recommended: [Render](https://render.com) — free/low-cost, simple, and built for exactly this (a small always-on Node web service).

Manual setup:
1. New → Web Service → connect your GitHub repo.
2. Build command: `npm install`
3. Start command: `npm run server`
4. Environment variables: `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, `CORS_ORIGIN` (set this once you have the frontend URL in step 2), and optionally `OLLAMA_BASE_URL` / `OLLAMA_MODEL` (see the caveat below). Render supplies its own `PORT`, which `provider-proxy.mjs` already reads via `process.env.PORT`.

Or use the included `render.yaml` blueprint: in Render, New → Blueprint → point it at this repo, and it will read `render.yaml` and prompt you for the secret values instead of clicking through the form manually.

Other hosts work the same way since it's just `npm run server`: Railway, Fly.io, or a small VPS with `pm2 start server/provider-proxy.mjs`.

This backend is a plain Node `http` server, not a serverless function, so it's a poor fit for Vercel/Netlify Functions without rewriting it — an always-on host like Render is the simplest match for how it's built today.

### 2. Deploy the frontend

Recommended: [Vercel](https://vercel.com) or [Netlify](https://netlify.com) — both auto-detect Vite projects.

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable (build-time): `VITE_PROVIDER_PROXY_URL` = your backend's URL from step 1 (e.g. `https://your-backend.onrender.com`)

Because Vite inlines `VITE_` variables at build time, set this before the first deploy, and trigger a rebuild any time the backend URL changes.

### 3. Close the loop on CORS

Go back to the backend's `CORS_ORIGIN` environment variable and set it to your deployed frontend's exact URL (e.g. `https://your-app.vercel.app`), then restart/redeploy the backend so it accepts requests from it.

### 4. What works for visitors once this is live

Works out of the box: script writing/parsing, timing, QC, Craft Quality scoring, mock voices, and — once `ELEVENLABS_API_KEY` is set on the backend — real ElevenLabs speech, sound effects, music, dubbing, voice changer, and full-spot MP3 rendering.

Won't work for visitors by default: the "generate full production plan" feature (Llama 3 via Ollama), because Ollama is meant to run on your own machine, not a small hosted box. Your options:
- Point `OLLAMA_BASE_URL` at an Ollama instance you host yourself on a server with enough CPU/RAM (or GPU) to run Llama 3 — this is a separate, heavier piece of infrastructure from the rest of this app.
- Or leave it unset. The rest of the app works fine without it; visitors just use the manual brief/script flow instead of the one-shot AI planner.

### 5. Sanity checks after deploying

```bash
curl https://your-backend.onrender.com/health
curl https://your-backend.onrender.com/api/providers/status
```

Both should return JSON without exposing your key (the status route only reports booleans).
