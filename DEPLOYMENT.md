# Deploying Napkin Audio AI Studio

This project has two pieces that deploy separately:

1. **Frontend** — the Vite/React app (`npm run build` → static files). Deploy to any static host.
2. **Backend** — `server/provider-proxy.mjs`, a small always-on Node process that holds your ElevenLabs key server-side. Deploy to any host that runs a persistent Node process.

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

## 1. Deploy the backend (provider-proxy) first

Recommended: [Render](https://render.com) — free/low-cost, simple, and built for exactly this (a small always-on Node web service).

Manual setup:
1. New → Web Service → connect your GitHub repo.
2. Build command: `npm install`
3. Start command: `npm run server`
4. Environment variables: `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, `CORS_ORIGIN` (set this once you have the frontend URL in step 2), and optionally `OLLAMA_BASE_URL` / `OLLAMA_MODEL` (see the caveat below). Render supplies its own `PORT`, which `provider-proxy.mjs` already reads via `process.env.PORT`.

Or use the included `render.yaml` blueprint: in Render, New → Blueprint → point it at this repo, and it will read `render.yaml` and prompt you for the secret values instead of clicking through the form manually.

Other hosts work the same way since it's just `npm run server`: Railway, Fly.io, or a small VPS with `pm2 start server/provider-proxy.mjs`.

This backend is a plain Node `http` server, not a serverless function, so it's a poor fit for Vercel/Netlify Functions without rewriting it — an always-on host like Render is the simplest match for how it's built today.

## 2. Deploy the frontend

Recommended: [Vercel](https://vercel.com) or [Netlify](https://netlify.com) — both auto-detect Vite projects.

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable (build-time): `VITE_PROVIDER_PROXY_URL` = your backend's URL from step 1 (e.g. `https://your-backend.onrender.com`)

Because Vite inlines `VITE_` variables at build time, set this before the first deploy, and trigger a rebuild any time the backend URL changes.

## 3. Close the loop on CORS

Go back to the backend's `CORS_ORIGIN` environment variable and set it to your deployed frontend's exact URL (e.g. `https://your-app.vercel.app`), then restart/redeploy the backend so it accepts requests from it.

## 4. What works for visitors once this is live

Works out of the box: script writing/parsing, timing, QC, Craft Quality scoring, mock voices, and — once `ELEVENLABS_API_KEY` is set on the backend — real ElevenLabs speech, sound effects, music, dubbing, voice changer, and full-spot MP3 rendering.

Won't work for visitors by default: the "generate full production plan" feature (Llama 3 via Ollama), because Ollama is meant to run on your own machine, not a small hosted box. Your options:
- Point `OLLAMA_BASE_URL` at an Ollama instance you host yourself on a server with enough CPU/RAM (or GPU) to run Llama 3 — this is a separate, heavier piece of infrastructure from the rest of this app.
- Or leave it unset. The rest of the app works fine without it; visitors just use the manual brief/script flow instead of the one-shot AI planner.

## 5. Sanity checks after deploying

```bash
curl https://your-backend.onrender.com/health
curl https://your-backend.onrender.com/api/providers/status
```

Both should return JSON without exposing your key (the status route only reports booleans).
