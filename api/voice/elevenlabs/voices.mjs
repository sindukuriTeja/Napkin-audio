import { corsHeaders, mockElevenLabsVoices, buildElevenLabsUrl, normalizeElevenLabsVoices } from "../../_lib/shared.mjs";

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(origin) });
    return res.end(JSON.stringify({
      source: "mock",
      warning: "ELEVENLABS_API_KEY is not configured. Returning mock voice options for demo.",
      voices: mockElevenLabsVoices,
    }));
  }

  try {
    const providerResponse = await fetch(buildElevenLabsUrl("/voices"), {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });

    if (!providerResponse.ok) {
      const contentType = providerResponse.headers.get("content-type") ?? "";
      const detail = contentType.includes("application/json") ? await providerResponse.json() : await providerResponse.text();
      res.writeHead(providerResponse.status, { "Content-Type": "application/json", ...corsHeaders(origin) });
      return res.end(JSON.stringify({ error: "ElevenLabs voice catalog request failed.", status: providerResponse.status, detail }));
    }

    const payload = await providerResponse.json();
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(origin) });
    res.end(JSON.stringify({ source: "elevenlabs", voices: normalizeElevenLabsVoices(payload) }));
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders(origin) });
    res.end(JSON.stringify({ error: "Failed to reach ElevenLabs.", detail: error.message }));
  }
}
