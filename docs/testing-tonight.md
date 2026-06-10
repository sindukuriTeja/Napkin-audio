# RA Studio Testing Checklist

Use this checklist for a focused manual test session.

## Setup

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, usually `http://127.0.0.1:5173/`.

Optional provider proxy smoke test:

```bash
npm run server
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/providers/status
```

## Core Flow

- Home loads with project name, brand, duration, approval status, quality score, versions, and next craft move.
- Brief fields can be edited without crashing.
- Duration can be changed to 10, 15, 20, 30, 40, 50, 60, and 120 seconds.
- Script tab accepts pasted copy and reparses it.
- `.txt` and `.md` upload works.
- Unsupported upload types show a clear warning.
- Parser identifies SFX, music, legal, CTA, announcer, character, and brand mnemonic lines.
- Parsed lines can be edited directly.
- Line type can be manually retagged.
- Voice role can be manually assigned to voice lines.
- Performance notes can be adjusted line by line.
- Timing updates and warnings are understandable.
- Legal lines show clear performance guidance.
- Craft Quality tab shows overall score, score band, sub-scores, suggested actions, and recommendation.
- Voices tab shows voice roles and can generate a mock take record.
- Sound tab shows sound cues and visual timeline.
- Mix sliders move and do not break layout.
- Export tab downloads project JSON, script markdown, cue sheet, QC report, Craft Quality report, and production notes.
- Project JSON can be imported again using `Import JSON`.
- Browser refresh preserves the current project through autosave.
- `New Project` clears the browser autosave after confirmation.

## Command Flow

Try these commands:

- `Slow down the legal line`
- `Make the ending land`
- `Add a Cork accent`
- `Make the music more cinematic`
- `Remove the sound effect at five seconds`

For each command:

- Command appears in Craft Memory > Command Log.
- Status starts as `proposed`.
- `Apply` changes status to `applied`.
- `Reject` changes status to `rejected`.
- Applied commands create a new version entry.
- Browser refresh preserves the command state.

## QC And Approval

- QC shows human approval as fail until status is explicitly changed to `Approved for broadcast`.
- Station spec remains unknown/unverified.
- Rights warnings remain visible for unknown music/SFX assets.
- The app never claims the spot is automatically broadcast-ready.

## Known Non-Goals For Tonight

- Do not expect real audio generation.
- Do not expect real mastering, loudness, clipping, or true peak analysis.
- Do not expect verified station delivery specs.
- Do not enter real API keys into the frontend.
- Do not treat mock voice takes as production assets.

## Issue Notes

Record each issue with:

- Browser and device.
- What tab you were on.
- Script or project JSON used.
- Steps to reproduce.
- Expected result.
- Actual result.
- Screenshot if visual.
