import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8787);

export const json = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(body, null, 2));
};

export const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export const providerStatus = (env = process.env) => ({
  elevenLabs: {
    configured: Boolean(env.ELEVENLABS_API_KEY),
    defaultVoiceIdConfigured: Boolean(env.ELEVENLABS_DEFAULT_VOICE_ID),
  },
  nvidiaRiva: {
    configured: Boolean(env.NVIDIA_RIVA_ENDPOINT && env.NVIDIA_RIVA_API_KEY),
    endpointConfigured: Boolean(env.NVIDIA_RIVA_ENDPOINT),
  },
  nvidiaNim: {
    configured: Boolean(env.NVIDIA_NIM_API_KEY),
  },
});

export const validateVoiceRequest = (body) => {
  if (!body || typeof body !== "object") return "Expected a JSON body.";
  if (typeof body.text !== "string" || !body.text.trim()) return "Missing required text.";
  if (body.text.length > 5000) return "Text is too long for a single preview request.";
  return null;
};

export const handleElevenLabsPreview = async (request, response, env = process.env) => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, {
      error: "ELEVENLABS_API_KEY is not configured.",
      fallback: "Use MockVoiceProvider in the frontend until credentials are available.",
    });
  }

  const body = await readJson(request);
  const validationError = validateVoiceRequest(body);
  if (validationError) return json(response, 400, { error: validationError });

  const voiceId = body.voiceId ?? env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!voiceId) {
    return json(response, 400, {
      error: "No voiceId supplied and ELEVENLABS_DEFAULT_VOICE_ID is not configured.",
    });
  }

  return json(response, 501, {
    error: "Real ElevenLabs audio streaming is not enabled in this scaffold yet.",
    nextStep:
      "Wire this endpoint to ElevenLabs text-to-speech, stream audio bytes, and persist rights/take metadata server-side.",
    requestAccepted: {
      voiceId,
      modelId: body.modelId ?? "eleven_multilingual_v2",
      textLength: body.text.length,
      outputFormat: body.outputFormat ?? "mp3_44100_128",
    },
  });
};

export const handleRivaPreview = async (request, response, env = process.env) => {
  if (!(env.NVIDIA_RIVA_ENDPOINT && env.NVIDIA_RIVA_API_KEY)) {
    return json(response, 401, {
      error: "NVIDIA_RIVA_ENDPOINT and NVIDIA_RIVA_API_KEY are not configured.",
      fallback: "Use MockVoiceProvider in the frontend until credentials are available.",
    });
  }

  const body = await readJson(request);
  const validationError = validateVoiceRequest(body);
  if (validationError) return json(response, 400, { error: validationError });

  return json(response, 501, {
    error: "NVIDIA Riva synthesis is not enabled in this scaffold yet.",
    nextStep: "Connect the configured Riva endpoint with SSML, streaming, and pronunciation dictionary support.",
    requestAccepted: {
      textLength: body.text.length,
      ssml: Boolean(body.ssml),
      endpointConfigured: true,
    },
  });
};

export const createProviderProxyServer = (env = process.env) =>
  createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return json(response, 204, {});
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true, service: "RA Studio provider proxy" });
    }
    if (request.method === "GET" && request.url === "/api/providers/status") {
      return json(response, 200, providerStatus(env));
    }
    if (request.method === "POST" && request.url === "/api/voice/elevenlabs/preview") {
      return handleElevenLabsPreview(request, response, env);
    }
    if (request.method === "POST" && request.url === "/api/voice/riva/preview") {
      return handleRivaPreview(request, response, env);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, {
      error: "Provider proxy error",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createProviderProxyServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`RA Studio provider proxy listening on http://127.0.0.1:${port}`);
  });
}
