import { corsHeaders, buildElevenLabsUrl } from "../../_lib/shared.mjs";

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders(origin) });
    return res.end(JSON.stringify({ error: "ELEVENLABS_API_KEY is not configured." }));
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  if (chunks.length) {
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(origin) });
      return res.end(JSON.stringify({ error: "Request body must be valid JSON." }));
    }
  }

  if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(origin) });
    return res.end(JSON.stringify({ error: "lines array is required." }));
  }

  const defaultVoiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  const audioChunks = [];

  for (const line of body.lines) {
    const text = String(line.text || "").trim();
    if (!text) continue;

    const voiceId = line.voiceId || defaultVoiceId;
    if (!voiceId) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(origin) });
      return res.end(JSON.stringify({ error: `No voiceId for line "${text.slice(0, 40)}..."` }));
    }

    try {
      const providerResponse = await fetch(buildElevenLabsUrl(`/text-to-speech/${encodeURIComponent(voiceId)}`, "mp3_44100_128"), {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: line.voiceSettings || { stability: 0.55, similarity_boost: 0.78, style: 0.08, use_speaker_boost: true },
          apply_text_normalization: "auto",
        }),
      });

      if (!providerResponse.ok) {
        const detail = await providerResponse.text();
        res.writeHead(providerResponse.status, { "Content-Type": "application/json", ...corsHeaders(origin) });
        return res.end(JSON.stringify({ error: `ElevenLabs failed for line "${text.slice(0, 40)}..."`, detail: detail.slice(0, 300) }));
      }

      audioChunks.push(Buffer.from(await providerResponse.arrayBuffer()));
      const pauseMs = Number(line.pauseAfterMs ?? 300);
      if (pauseMs > 0) audioChunks.push(Buffer.alloc(Math.floor(pauseMs * 16), 0xff));
    } catch (error) {
      res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders(origin) });
      return res.end(JSON.stringify({ error: `Network error for line "${text.slice(0, 40)}..."`, detail: error.message }));
    }
  }

  if (audioChunks.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(origin) });
    return res.end(JSON.stringify({ error: "No audio generated." }));
  }

  const combined = Buffer.concat(audioChunks);
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Disposition": 'attachment; filename="full-spot.mp3"',
    "Content-Length": combined.length,
    ...corsHeaders(origin),
  });
  res.end(combined);
}
