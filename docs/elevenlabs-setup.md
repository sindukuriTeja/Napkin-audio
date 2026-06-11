# ElevenLabs Setup

Napkin Audio AI Studio is designed so ElevenLabs keys stay server-side. Do not put real API keys into frontend code.

## 1. Create `.env`

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Add your key and a real ElevenLabs voice ID:

```env
VITE_PROVIDER_PROXY_URL=http://127.0.0.1:8787
ELEVENLABS_API_KEY=your_real_key_here
ELEVENLABS_DEFAULT_VOICE_ID=your_voice_id_here
PORT=8787
CORS_ORIGIN=http://127.0.0.1:5173
```

Keep `.env` local. It is ignored by Git.

`npm run server` reads `.env` automatically. For local development, `.env` wins over inherited shell values so a stale key in your terminal cannot block the key you paste here.

## 2. Start both processes

Terminal 1:

```bash
npm run server
```

Terminal 2:

```bash
npm run dev
```

## 3. Verify in Napkin Audio AI Studio

- Open the app.
- Switch to Producer Mode.
- Go to Voices.
- Click `Check Providers`.

Expected result after adding a key:

- ElevenLabs key: `Detected`
- Default voice: `Configured`
- Audio routes: `Ready`

## Server-side ElevenLabs routes

The local proxy keeps the API key out of the browser and forwards these routes:

- `POST /api/voice/elevenlabs/preview`
- `POST /api/voice/elevenlabs/voice-changer`
- `POST /api/sound/elevenlabs/effect`
- `POST /api/music/elevenlabs/compose`
- `POST /api/dubbing/elevenlabs/create`

Voice, VO voice transformation, sound effect, and music routes return audio bytes from ElevenLabs when a real key is configured. Dubbing currently supports JSON requests with a public `sourceUrl`; saved project assets and final mix rendering are still future work.

## Current limitation

The app UI can check provider readiness and still records mock takes by default. The backend proxy is ready for live provider calls, but the frontend does not yet save returned audio assets into the project package or render a full mixed spot.

## Safe curl checks

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/providers/status
```

These endpoints return booleans only and do not expose the key.
