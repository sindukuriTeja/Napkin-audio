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

  if (!body.text || !body.text.trim()) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(origin) });
    return res.end(JSON.stringify({ error: "Missing required text." }));
  }

  const voiceId = body.voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!voiceId) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(origin) });
    return res.end(JSON.stringify({ error: "No voiceId supplied and ELEVENLABS_DEFAULT_VOICE_ID is not configured." }));
  }

  try {
    const providerResponse = await fetch(buildElevenLabsUrl(`/text-to-speech/${encodeURIComponent(voiceId)}`, body.outputFormat || "mp3_44100_128"), {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: body.text,
        model_id: body.modelId || "eleven_multilingual_v2",
        language_code: body.languageCode,
        voice_settings: body.voiceSettings,
        apply_text_normalization: body.applyTextNormalization || "auto",
      }),
    });

    if (!providerResponse.ok) {
      const detail = await providerResponse.text();
      res.writeHead(providerResponse.status, { "Content-Type": "application/json", ...corsHeaders(origin) });
      return res.end(JSON.stringify({ error: "ElevenLabs request failed.", detail: detail.slice(0, 500) }));
    }

    const audioBuffer = Buffer.from(await providerResponse.arrayBuffer());
    const headers = { "Content-Type": "audio/mpeg", ...corsHeaders(origin) };
    for (const h of ["character-cost", "request-id", "history-item-id"]) {
      const v = providerResponse.headers.get(h);
      if (v) headers[h] = v;
    }
    res.writeHead(200, headers);
    res.end(audioBuffer);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders(origin) });
    res.end(JSON.stringify({ error: "Network error reaching ElevenLabs.", detail: error.message }));
  }
}
