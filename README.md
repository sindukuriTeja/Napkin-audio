# Napkin Audio AI Studio

Napkin Audio AI Studio is a local-first AI audio craft studio for writing, directing, judging, and packaging radio advertising work. It is designed for creative directors, copywriters, producers, sound designers, and agency teams who need a practical studio for script craft, timing, performance, sound design, rough mix planning, QC, and export discipline.

This repo was prepared from the original RA Studio build pack and recreates/improves the earlier `test-codex-2` Broadcast Blueprint Studio direction inside the current Napkin Audio repository.

## Run locally

```bash
npm install
npm run dev      # frontend (Vite), usually http://127.0.0.1:5173
npm run server   # provider proxy (ElevenLabs + Claude), http://127.0.0.1:8787
npm run demo:check  # verifies provider status redaction, mock voices, RAG data
npm test         # vitest unit tests
npm run build    # tsc -b && vite build
```

`npm run dev` and `npm run server` run in separate terminals/windows at the same time. On Windows, `start-studio.bat` starts both for you in one click, checks that `ANTHROPIC_API_KEY` is set, and runs `npm install` automatically if `node_modules` is missing.

For a focused manual QA pass, use [docs/testing-tonight.md](docs/testing-tonight.md).

Use `New Project` in the header to clear the browser autosave after exporting JSON.

For ElevenLabs credential setup, use [docs/elevenlabs-setup.md](docs/elevenlabs-setup.md).

For the current local studio knowledge retrieval layer, use [docs/rag-knowledge.md](docs/rag-knowledge.md).

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, and `npm run build` on Node 22 for pull requests and pushes to `main` and `codex/**`.

To put this live for other people to use, see [DEPLOYMENT.md](DEPLOYMENT.md).

## What is included

- Vite, React, and TypeScript app.
- Brief panel with brand, campaign, audience, tone, mandatories, legal lines, duration, accent, and sonic notes.
- Script paste and `.txt` / `.md` upload.
- Deterministic script parser for voice, announcer, character, SFX, music, pause, legal, CTA, and brand mnemonic lines.
- Runtime estimator, words-per-second calculation, legal speed risk, and duration warnings.
- Emotion, comedy, timing, performance, sound design, mix, station delivery, QC, and Craft Quality agents.
- Autonomous full production planning via the Claude API: from a single text input, it drafts the script, voice roles, sound cues, music cues, and a sonic-logo/brand mnemonic.
- Voice casting panel with mock take generation.
- Full-spot rendering: concatenates every spoken line into one downloadable MP3 via ElevenLabs, with silence padding between lines.
- VO Voice Transformer path for approved source recordings, consent confirmation, and ElevenLabs speech-to-speech preview generation.
- Voice-provider abstraction for `MockVoiceProvider`, `ElevenLabsProvider`, and `NvidiaRivaProvider`.
- Optional local provider proxy scaffold for server-side provider credentials.
- Sound world panel and visual timeline.
- Rough mix control surface with browser-based (Web Audio) mix rendering, exported as a downloadable MP3.
- Audio Director for spoken production decisions, plus typed command fallback.
- Browser speech-recognition support where available; spoken commands become reviewable Apply/Reject proposals.
- Apply/reject command proposals, with browser autosave for the current project.
- Local seed RAG-style studio knowledge retrieval for timing, casting, sound design, mix, export QC, and compliance guidance.
- Craft Quality Score with sub-scores, strengths, improvements, next craft move, and producer-review guidance.
- Irish radio export preset and station-spec data with confidence labels.
- QC checks for duration, mandatories, CTA, legal speed, voice assignment, rights, station specs, and human approval.
- Export downloads for project JSON, script markdown, cue sheet markdown, QC markdown, Craft Quality markdown, and production notes markdown.
- Project JSON import for continuing a previously exported package.
- Studio Memory, command log, and version history.

## Architecture

```text
src/
  App.tsx
  styles/
  agents/
    studioAgents.ts
  data/
    importedStudioKnowledge.ts
    sampleProject.ts
    stationSpecs.ts
    studioKnowledge.ts
  export/
    exportPackage.ts
  lib/
    id.ts
    timing.ts
  services/
    voiceProviders.ts
  types/
    models.ts
server/
  provider-proxy.mjs
scripts/
  demo-readiness.mjs
  import-napkin-rag.mjs
```

The MVP is deterministic and local-first. Agents accept structured project state and return structured recommendations. They do not overwrite user work automatically. Provider interfaces are present so real services can replace the local heuristics later.

## Provider setup

Copy `.env.example` to `.env` when you add real provider work:

```env
VITE_APP_NAME=Napkin Audio AI Studio
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
NVIDIA_RIVA_ENDPOINT=
NVIDIA_RIVA_API_KEY=
NVIDIA_NIM_API_KEY=
PORT=8787
CORS_ORIGIN=http://127.0.0.1:5173
```

Important: the frontend MVP does not call real voice APIs with secrets from the browser. A local provider proxy is available with `npm run server`; it keeps provider keys server-side and can forward live ElevenLabs speech, SFX, music, and source-URL dubbing requests when credentials are configured, plus Claude API production-planning requests.

Provider proxy endpoints:

- `GET /health`
- `GET /api/providers/status`
- `POST /api/llm/production-plan` (Claude)
- `GET /api/voice/elevenlabs/voices`
- `POST /api/voice/elevenlabs/preview`
- `POST /api/voice/elevenlabs/full-spot`
- `POST /api/voice/elevenlabs/voice-changer`
- `POST /api/sound/elevenlabs/effect`
- `POST /api/music/elevenlabs/compose`
- `POST /api/dubbing/elevenlabs/create`
- `GET /api/dubbing/elevenlabs/status?dubbingId=...`
- `GET /api/dubbing/elevenlabs/audio?dubbingId=...&lang=...`
- `POST /api/voice/riva/preview`

## ElevenLabs

The app includes an ElevenLabs provider path for `voice_id`, `model_id`, text, output format, settings, pronunciation support, continuity context, source VO voice transformation, sound effect prompts, music prompts, and source-URL dubbing jobs. The proxy can return live audio bytes, and `/api/voice/elevenlabs/full-spot` will concatenate a full set of scripted lines into one downloadable MP3. The frontend still needs durable asset persistence and full mix rendering/mastering before this is a complete production audio workflow. See [docs/elevenlabs-setup.md](docs/elevenlabs-setup.md).

## LLM planning (Claude)

The Studio tab can generate a complete production plan (script lines, voice roles, sound cues, music cues, and a sonic-logo/brand mnemonic) from a single text input, autonomously, using the Claude API.

Setup:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. Set `ANTHROPIC_API_KEY` in `.env`. Optionally set `ANTHROPIC_MODEL` (default `claude-sonnet-5`).
3. Start the proxy with `npm run server`; it calls the Claude Messages API from `POST /api/llm/production-plan`.

The proxy allows up to 2 minutes before timing out. If `ANTHROPIC_API_KEY` is missing or the Claude API is unreachable, the proxy returns a clear error and the rest of the app (mock and ElevenLabs voices, manual script entry) keeps working without it. `start-studio.bat` checks that the key is set on launch.

## NVIDIA Riva / NIM

The NVIDIA Riva adapter is a planned enterprise adapter for streaming/offline synthesis, SSML, pronunciation dictionaries, and emotion controls where available. NIM is represented in the provider architecture as a future reasoning provider. Neither is required for local MVP use.

## Irish radio export

The app includes a generic Irish radio package preset and station rows for RTE Radio 1, RTE 2FM, Today FM, Newstalk, FM104, 98FM, Spin, iRadio, Galway Bay FM, Cork's Red FM, Beat, Midlands 103, Highland Radio, LMFM, Sunshine, Classic Hits, Q102, and Other/custom.

Station-specific technical values are deliberately marked `unknown` unless verified. Napkin Audio AI Studio does not fabricate sample rate, loudness, true peak, naming, or delivery requirements. Confirm station traffic specs before dispatch.

## Rights and approval

Napkin Audio AI Studio never labels a spot broadcast-ready automatically. QC can say a package is checked or ready for producer review, but only an explicit user action can set `Approved for broadcast`.

Rights records track source, licence status, owner, expiry, territory, channel, notes, and confidence. Unknown or needs-clearance rights are flagged before export.

## Craft Quality Score

Craft Quality is a lightweight final-stage quality gate. It gives an overall score out of 100 and sub-scores for idea strength, script clarity, emotional impact, comedy/memorability, performance, voice direction, sound design, timing, brand fit, CTA/legal handling, and production readiness.

It does not claim awards performance, guaranteed effectiveness, or automatic broadcast approval.

## Known limitations

- No full mastering (loudness/true-peak/mastering chain) in v1; full-spot MP3 concatenation and browser Web Audio mixing exist, but there is no server-side rendering/mastering pipeline yet.
- `.docx` upload is not implemented; paste extracted text or upload `.txt` / `.md`.
- ElevenLabs live calls require the local provider proxy plus a configured key and plan access; NVIDIA Riva and NIM remain scaffolds.
- Full production planning requires a configured `ANTHROPIC_API_KEY` and network access to the Claude API.
- Loudness, true peak, clipping, file format, head/tail silence, and station compliance checks are placeholders until production audio analysis is added.
- Station specifications remain unverified and must be confirmed with current station delivery requirements.
- Studio knowledge retrieval is currently local keyword scoring over seed and imported chunks from the Napkin Audio AI Studio RAG Knowledge Dataset, not a full external vector RAG pipeline.

## Next development phases

1. Persist returned provider audio as project assets.
2. Add server-side mastering/rendering (e.g. FFmpeg) on top of the existing browser Web Audio mix and full-spot MP3 concatenation.
3. Add `.docx` parsing.
4. Add richer version compare/restore.
5. Add station-spec verification workflow and dated source links.
6. Add real asset-rights intake for uploaded SFX/music.
7. Expand automated tests around parser, QC, Craft Quality scoring, and the LLM production-plan flow.
8. Add embedding/vector search on top of the existing imported knowledge dataset.
