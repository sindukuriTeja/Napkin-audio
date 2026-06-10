import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 8787);

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Content-Type,Content-Length,character-cost,request-id,history-item-id,song-id",
});

export const loadLocalEnv = (filePath = resolve(process.cwd(), ".env"), env = process.env) => {
  if (!existsSync(filePath)) return [];
  const loadedKeys = [];
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
    loadedKeys.push(key);
  }
  return loadedKeys;
};

export const json = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...corsHeaders(),
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
    capabilities: {
      speech: Boolean(env.ELEVENLABS_API_KEY),
      soundEffects: Boolean(env.ELEVENLABS_API_KEY),
      music: Boolean(env.ELEVENLABS_API_KEY),
      dubbing: Boolean(env.ELEVENLABS_API_KEY),
    },
  },
  nvidiaRiva: {
    configured: Boolean(env.NVIDIA_RIVA_ENDPOINT && env.NVIDIA_RIVA_API_KEY),
    endpointConfigured: Boolean(env.NVIDIA_RIVA_ENDPOINT),
  },
  nvidiaNim: {
    configured: Boolean(env.NVIDIA_NIM_API_KEY),
  },
});

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const isNumberInRange = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export const validateVoiceRequest = (body) => {
  if (!body || typeof body !== "object") return "Expected a JSON body.";
  if (typeof body.text !== "string" || !body.text.trim()) return "Missing required text.";
  if (body.text.length > 5000) return "Text is too long for a single preview request.";
  return null;
};

export const validateSoundEffectRequest = (body) => {
  if (!body || typeof body !== "object") return "Expected a JSON body.";
  if (!isNonEmptyString(body.text)) return "Missing required sound effect prompt text.";
  if (body.text.length > 1000) return "Sound effect prompt is too long for a single request.";
  if (body.durationSeconds !== undefined && !isNumberInRange(body.durationSeconds, 0.5, 30)) {
    return "durationSeconds must be between 0.5 and 30.";
  }
  if (body.promptInfluence !== undefined && !isNumberInRange(body.promptInfluence, 0, 1)) {
    return "promptInfluence must be between 0 and 1.";
  }
  return null;
};

export const validateMusicRequest = (body) => {
  if (!body || typeof body !== "object") return "Expected a JSON body.";
  const hasPrompt = isNonEmptyString(body.prompt);
  const hasCompositionPlan = Boolean(body.compositionPlan && typeof body.compositionPlan === "object");
  if (!hasPrompt && !hasCompositionPlan) return "Missing prompt or compositionPlan.";
  if (hasPrompt && hasCompositionPlan) return "Use prompt or compositionPlan, not both.";
  if (hasPrompt && body.prompt.length > 4100) return "Music prompt must be 4100 characters or fewer.";
  if (body.musicLengthMs !== undefined && !isNumberInRange(body.musicLengthMs, 3000, 600000)) {
    return "musicLengthMs must be between 3000 and 600000.";
  }
  if (body.seed !== undefined && !Number.isInteger(body.seed)) return "seed must be an integer.";
  return null;
};

export const validateDubbingRequest = (body) => {
  if (!body || typeof body !== "object") return "Expected a JSON body.";
  if (!isNonEmptyString(body.targetLang)) return "Missing required targetLang.";
  if (!isNonEmptyString(body.sourceUrl)) return "This proxy route currently supports sourceUrl JSON requests only.";
  try {
    const sourceUrl = new URL(body.sourceUrl);
    if (!["http:", "https:"].includes(sourceUrl.protocol)) return "sourceUrl must be an http or https URL.";
  } catch {
    return "sourceUrl must be a valid URL.";
  }
  return null;
};

const outputQuery = (outputFormat) => (isNonEmptyString(outputFormat) ? `?output_format=${encodeURIComponent(outputFormat)}` : "");

export const buildElevenLabsUrl = (path, outputFormat) => `${ELEVENLABS_API_BASE}${path}${outputQuery(outputFormat)}`;

const forwardElevenLabsResponse = async (providerResponse, response, fallbackContentType = "audio/mpeg") => {
  const contentType = providerResponse.headers.get("content-type") ?? fallbackContentType;
  const passThroughHeaders = {
    "Content-Type": contentType,
    ...corsHeaders(),
  };
  for (const header of ["character-cost", "request-id", "history-item-id", "song-id"]) {
    const value = providerResponse.headers.get(header);
    if (value) passThroughHeaders[header] = value;
  }

  if (!providerResponse.ok) {
    const detail = contentType.includes("application/json") ? await providerResponse.json() : await providerResponse.text();
    return json(response, providerResponse.status, {
      error: "ElevenLabs request failed.",
      status: providerResponse.status,
      detail,
    });
  }

  const audioBuffer = Buffer.from(await providerResponse.arrayBuffer());
  response.writeHead(providerResponse.status, passThroughHeaders);
  response.end(audioBuffer);
};

const elevenLabsJsonRequest = ({ env, path, outputFormat, body }) =>
  fetch(buildElevenLabsUrl(path, outputFormat), {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

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

  const providerResponse = await elevenLabsJsonRequest({
    env,
    path: `/text-to-speech/${encodeURIComponent(voiceId)}`,
    outputFormat: body.outputFormat ?? "mp3_44100_128",
    body: {
      text: body.text,
      model_id: body.modelId ?? "eleven_multilingual_v2",
      language_code: body.languageCode,
      voice_settings: body.voiceSettings,
      pronunciation_dictionary_locators: body.pronunciationDictionaryLocators,
      previous_text: body.previousText,
      next_text: body.nextText,
      apply_text_normalization: body.applyTextNormalization ?? "auto",
    },
  });
  return forwardElevenLabsResponse(providerResponse, response);
};

export const handleElevenLabsSoundEffect = async (request, response, env = process.env) => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, {
      error: "ELEVENLABS_API_KEY is not configured.",
      fallback: "Use mock sound design cues until credentials are available.",
    });
  }

  const body = await readJson(request);
  const validationError = validateSoundEffectRequest(body);
  if (validationError) return json(response, 400, { error: validationError });

  const providerResponse = await elevenLabsJsonRequest({
    env,
    path: "/sound-generation",
    outputFormat: body.outputFormat ?? "mp3_44100_128",
    body: {
      text: body.text,
      loop: body.loop ?? false,
      duration_seconds: body.durationSeconds,
      prompt_influence: body.promptInfluence ?? 0.3,
      model_id: body.modelId ?? "eleven_text_to_sound_v2",
    },
  });
  return forwardElevenLabsResponse(providerResponse, response);
};

export const handleElevenLabsMusic = async (request, response, env = process.env) => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, {
      error: "ELEVENLABS_API_KEY is not configured.",
      fallback: "Use planned music cue sheets until credentials are available.",
    });
  }

  const body = await readJson(request);
  const validationError = validateMusicRequest(body);
  if (validationError) return json(response, 400, { error: validationError });

  const providerResponse = await elevenLabsJsonRequest({
    env,
    path: "/music",
    outputFormat: body.outputFormat ?? "mp3_44100_128",
    body: {
      prompt: body.prompt,
      composition_plan: body.compositionPlan,
      music_length_ms: body.musicLengthMs,
      model_id: body.modelId ?? "music_v1",
      seed: body.seed,
      force_instrumental: body.forceInstrumental ?? true,
      respect_sections_durations: body.respectSectionsDurations ?? true,
      sign_with_c2pa: body.signWithC2pa ?? true,
    },
  });
  return forwardElevenLabsResponse(providerResponse, response);
};

export const handleElevenLabsDubbing = async (request, response, env = process.env) => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, {
      error: "ELEVENLABS_API_KEY is not configured.",
      fallback: "Export dubbing notes and source scripts until credentials are available.",
    });
  }

  const body = await readJson(request);
  const validationError = validateDubbingRequest(body);
  if (validationError) return json(response, 400, { error: validationError });

  const form = new FormData();
  form.set("source_url", body.sourceUrl);
  form.set("target_lang", body.targetLang);
  form.set("source_lang", body.sourceLang ?? "auto");
  if (isNonEmptyString(body.name)) form.set("name", body.name);
  if (isNonEmptyString(body.targetAccent)) form.set("target_accent", body.targetAccent);
  if (body.numSpeakers !== undefined) form.set("num_speakers", String(body.numSpeakers));
  if (body.watermark !== undefined) form.set("watermark", String(Boolean(body.watermark)));
  if (body.startTime !== undefined) form.set("start_time", String(body.startTime));
  if (body.endTime !== undefined) form.set("end_time", String(body.endTime));
  if (body.dropBackgroundAudio !== undefined) form.set("drop_background_audio", String(Boolean(body.dropBackgroundAudio)));
  if (body.disableVoiceCloning !== undefined) form.set("disable_voice_cloning", String(Boolean(body.disableVoiceCloning)));

  const providerResponse = await fetch(buildElevenLabsUrl("/dubbing"), {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
    },
    body: form,
  });

  if (!providerResponse.ok) return forwardElevenLabsResponse(providerResponse, response, "application/json");
  const payload = await providerResponse.json();
  return json(response, 200, payload);
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
      return json(response, 200, { ok: true, service: "Napkin AI Audio Studio provider proxy" });
    }
    if (request.method === "GET" && request.url === "/api/providers/status") {
      return json(response, 200, providerStatus(env));
    }
    if (request.method === "POST" && request.url === "/api/voice/elevenlabs/preview") {
      return handleElevenLabsPreview(request, response, env);
    }
    if (request.method === "POST" && request.url === "/api/sound/elevenlabs/effect") {
      return handleElevenLabsSoundEffect(request, response, env);
    }
    if (request.method === "POST" && request.url === "/api/music/elevenlabs/compose") {
      return handleElevenLabsMusic(request, response, env);
    }
    if (request.method === "POST" && request.url === "/api/dubbing/elevenlabs/create") {
      return handleElevenLabsDubbing(request, response, env);
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadLocalEnv();
  const server = createProviderProxyServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Napkin AI Audio Studio provider proxy listening on http://127.0.0.1:${port}`);
  });
}
