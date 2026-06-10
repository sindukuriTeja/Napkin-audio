# RA Studio

RA Studio is a local-first AI radio craft studio for writing, directing, judging, and packaging radio advertising work. It is designed for creative directors, copywriters, producers, sound designers, and agency teams who need a practical studio for script craft, timing, performance, sound design, rough mix planning, QC, and export discipline.

This repo was prepared from the RA Studio build pack and recreates/improves the earlier `test-codex-2` Broadcast Blueprint Studio direction inside the current Napkin Audio repository.

## Run locally

```bash
npm install
npm run dev
npm run server
npm run build
```

## What is included

- Vite, React, and TypeScript app.
- Brief panel with brand, campaign, audience, tone, mandatories, legal lines, duration, accent, and sonic notes.
- Script paste and `.txt` / `.md` upload.
- Deterministic script parser for voice, announcer, character, SFX, music, pause, legal, CTA, and brand mnemonic lines.
- Runtime estimator, words-per-second calculation, legal speed risk, and duration warnings.
- Emotion, comedy, timing, performance, sound design, mix, station delivery, QC, and Craft Quality agents.
- Voice casting panel with mock take generation.
- Voice-provider abstraction for `MockVoiceProvider`, `ElevenLabsProvider`, and `NvidiaRivaProvider`.
- Optional local provider proxy scaffold for server-side provider credentials.
- Sound world panel and visual timeline.
- Rough mix control surface.
- Typed command bar and browser speech-recognition support where available.
- Apply/reject command proposals, with browser autosave for the current project.
- Craft Quality Score with sub-scores, strengths, improvements, next craft move, and producer-review guidance.
- Irish radio export preset and station-spec data with confidence labels.
- QC checks for duration, mandatories, CTA, legal speed, voice assignment, rights, station specs, and human approval.
- Export downloads for project JSON, script markdown, cue sheet markdown, QC markdown, Craft Quality markdown, and production notes markdown.
- Project JSON import for continuing a previously exported package.
- Craft Memory and version history.

## Architecture

```text
src/
  App.tsx
  styles/
  agents/
    studioAgents.ts
  data/
    sampleProject.ts
    stationSpecs.ts
  export/
    exportPackage.ts
  lib/
    id.ts
    timing.ts
  services/
    voiceProviders.ts
  types/
    models.ts
```

The MVP is deterministic and local-first. Agents accept structured project state and return structured recommendations. They do not overwrite user work automatically. Provider interfaces are present so real services can replace the local heuristics later.

## Provider setup

Copy `.env.example` to `.env` when you add real provider work:

```env
VITE_APP_NAME=RA Studio
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
NVIDIA_RIVA_ENDPOINT=
NVIDIA_RIVA_API_KEY=
NVIDIA_NIM_API_KEY=
PORT=8787
CORS_ORIGIN=http://127.0.0.1:5173
```

Important: the frontend MVP does not call real voice APIs with secrets from the browser. A local provider proxy scaffold is available with `npm run server`, but real audio synthesis is still deliberately disabled until the provider-specific streaming and persistence code is added.

Provider proxy endpoints:

- `GET /health`
- `GET /api/providers/status`
- `POST /api/voice/elevenlabs/preview`
- `POST /api/voice/riva/preview`

## ElevenLabs

The app includes an ElevenLabs provider class with the expected input shape: `voice_id`, `model_id`, text, output format, settings, pronunciation support, and continuity context. Real generation is disabled until a server-side proxy keeps `ELEVENLABS_API_KEY` out of the browser bundle.

## NVIDIA Riva / NIM

The NVIDIA Riva adapter is a planned enterprise adapter for streaming/offline synthesis, SSML, pronunciation dictionaries, and emotion controls where available. NIM is represented in the provider architecture as a future reasoning provider. Neither is required for local MVP use.

## Irish radio export

The app includes a generic Irish radio package preset and station rows for RTE Radio 1, RTE 2FM, Today FM, Newstalk, FM104, 98FM, Spin, iRadio, Galway Bay FM, Cork's Red FM, Beat, Midlands 103, Highland Radio, LMFM, Sunshine, Classic Hits, Q102, and Other/custom.

Station-specific technical values are deliberately marked `unknown` unless verified. RA Studio does not fabricate sample rate, loudness, true peak, naming, or delivery requirements. Confirm station traffic specs before dispatch.

## Rights and approval

RA Studio never labels a spot broadcast-ready automatically. QC can say a package is checked or ready for producer review, but only an explicit user action can set `Approved for broadcast`.

Rights records track source, licence status, owner, expiry, territory, channel, notes, and confidence. Unknown or needs-clearance rights are flagged before export.

## Craft Quality Score

Craft Quality is a lightweight final-stage quality gate. It gives an overall score out of 100 and sub-scores for idea strength, script clarity, emotional impact, comedy/memorability, performance, voice direction, sound design, timing, brand fit, CTA/legal handling, and production readiness.

It does not claim awards performance, guaranteed effectiveness, or automatic broadcast approval.

## Known limitations

- No real audio rendering or mastering in v1.
- `.docx` upload is not implemented; paste extracted text or upload `.txt` / `.md`.
- Real ElevenLabs, NVIDIA Riva, and NIM calls need a backend proxy.
- Loudness, true peak, clipping, file format, head/tail silence, and station compliance checks are placeholders until production audio analysis is added.
- Station specifications remain unverified and must be confirmed with current station delivery requirements.

## Next development phases

1. Add a secure Node/Express provider proxy for voice generation.
2. Add real audio preview/rendering with Web Audio or server-side FFmpeg.
3. Add `.docx` parsing.
4. Add richer version compare/restore.
5. Add station-spec verification workflow and dated source links.
6. Add real asset-rights intake for uploaded SFX/music.
7. Add automated tests around parser, QC, and Craft Quality scoring.
