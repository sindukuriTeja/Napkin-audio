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

  if (!body.prompt || !body.prompt.trim()) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(origin) });
    return res.end(JSON.stringify({ error: "Missing required music prompt." }));
  }

  try {
    const providerResponse = await fetch(buildElevenLabsUrl("/music", body.outputFormat || "mp3_44100_128"), {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: body.prompt,
        music_length_ms: body.musicLengthMs,
        model_id: body.modelId || "music_v1",
        seed: body.seed,
        force_instrumental: body.forceInstrumental ?? true,
        respect_sections_durations: body.respectSectionsDurations ?? true,
        sign_with_c2pa: body.signWithC2pa ?? true,
      }),
    });

    if (!providerResponse.ok) {
      const detail = await providerResponse.text();
      res.writeHead(providerResponse.status, { "Content-Type": "application/json", ...corsHeaders(origin) });
      return res.end(JSON.stringify({ error: "ElevenLabs music request failed.", detail: detail.slice(0, 500) }));
    }

    const audioBuffer = Buffer.from(await providerResponse.arrayBuffer());
    res.writeHead(200, { "Content-Type": "audio/mpeg", ...corsHeaders(origin) });
    res.end(audioBuffer);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders(origin) });
    res.end(JSON.stringify({ error: "Network error reaching ElevenLabs.", detail: error.message }));
  }
}
