# ElevenLabs Setup

RA Studio is designed so ElevenLabs keys stay server-side. Do not put real API keys into frontend code.

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

## 2. Start both processes

Terminal 1:

```bash
npm run server
```

Terminal 2:

```bash
npm run dev
```

## 3. Verify in RA Studio

- Open the app.
- Switch to Producer Mode.
- Go to Voices.
- Click `Check Providers`.

Expected result after adding a key:

- ElevenLabs key: `Detected`
- Default voice: `Configured`

## Current limitation

The proxy can detect credentials and validate preview requests, but real audio streaming is still scaffolded. The next implementation step is to wire `/api/voice/elevenlabs/preview` to ElevenLabs text-to-speech and return audio bytes or a saved take record.

## Safe curl checks

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/providers/status
```

These endpoints return booleans only and do not expose the key.
