import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 8787);

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const OLLAMA_API_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

export const mockElevenLabsVoices = [
  {
    voiceId: "mock-warm-irish-announcer",
    name: "Mock Warm Irish Announcer",
    category: "mock",
    description: "Warm, clear, radio-friendly Irish announcer for safe demos without credentials.",
    previewUrl: "",
    labels: { accent: "neutral Irish", age: "30-50", style: "warm, direct" },
    source: "mock",
  },
  {
    voiceId: "mock-dry-character",
    name: "Mock Dry Character",
    category: "mock",
    description: "Grounded character lane for conversational or lightly comic scripts.",
    previewUrl: "",
    labels: { accent: "Dublin", age: "25-45", style: "deadpan, natural" },
    source: "mock",
  },
  {
    voiceId: "mock-legal-clear",
    name: "Mock Legal Clear Read",
    category: "mock",
    description: "Measured legal or mandatory read reference with clarity ahead of speed.",
    previewUrl: "",
    labels: { accent: "neutral Irish", age: "30-60", style: "measured, clear" },
    source: "mock",
  },
];

const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173")
    .split(",")
    .map((o) => o.trim())
    .concat(["http://localhost:5173", "http://127.0.0.1:5173"])
);

const corsHeaders = (requestOrigin) => {
  let origin = "http://localhost:5173";
  if (requestOrigin) {
    if (
      ALLOWED_ORIGINS.has(requestOrigin) ||
      /^https?:\/\/localhost:\d+$/.test(requestOrigin) ||
      /^https?:\/\/127\.0\.0\.1:\d+$/.test(requestOrigin)
    ) {
      origin = requestOrigin;
    }
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Content-Type,Content-Length,character-cost,request-id,history-item-id,song-id",
    "Vary": "Origin",
  };
};

export const loadLocalEnv = (filePath = resolve(process.cwd(), ".env"), env = process.env, options = {}) => {
  if (!existsSync(filePath)) return [];
  const override = Boolean(options.override);
  const loadedKeys = [];
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || (!override && env[key] !== undefined)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
    loadedKeys.push(key);
  }
  return loadedKeys;
};

export const json = (response, statusCode, body, requestOrigin) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...corsHeaders(requestOrigin),
  });
  response.end(JSON.stringify(body, null, 2));
};

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

export const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidJsonBodyError();
  }
};

// Live-checks the local Ollama install so the UI can tell the user exactly what's wrong
// (unreachable vs. wrong model name) instead of them having to run `ollama list` themselves.
export const checkOllamaLive = async (baseUrl, model) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) return { reachable: false, modelsAvailable: [], modelFound: false, error: `Ollama responded with HTTP ${response.status}.` };
    const payload = await response.json();
    const modelsAvailable = Array.isArray(payload?.models) ? payload.models.map((m) => String(m.name ?? m.model ?? "")).filter(Boolean) : [];
    const modelFound = modelsAvailable.some((name) => name === model || name.startsWith(`${model}:`));
    return { reachable: true, modelsAvailable, modelFound, error: null };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      reachable: false,
      modelsAvailable: [],
      modelFound: false,
      error: isAbort ? "Ollama did not respond to a connection check within 4s." : `Could not reach Ollama: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const providerStatus = async (env = process.env) => {
  const ollamaBaseUrl = env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const ollamaModel = env.OLLAMA_MODEL || "llama3";
  const ollamaLive = await checkOllamaLive(ollamaBaseUrl, ollamaModel);
  return {
    elevenLabs: {
      configured: Boolean(env.ELEVENLABS_API_KEY),
      defaultVoiceIdConfigured: Boolean(env.ELEVENLABS_DEFAULT_VOICE_ID),
      capabilities: {
        speech: Boolean(env.ELEVENLABS_API_KEY),
        soundEffects: Boolean(env.ELEVENLABS_API_KEY),
        music: Boolean(env.ELEVENLABS_API_KEY),
        dubbing: Boolean(env.ELEVENLABS_API_KEY),
        voiceChanger: Boolean(env.ELEVENLABS_API_KEY),
      },
    },
    nvidiaRiva: {
      configured: Boolean(env.NVIDIA_RIVA_ENDPOINT && env.NVIDIA_RIVA_API_KEY),
      endpointConfigured: Boolean(env.NVIDIA_RIVA_ENDPOINT),
    },
    nvidiaNim: {
      configured: Boolean(env.NVIDIA_NIM_API_KEY),
    },
    ollama: {
      configured: true,
      model: ollamaModel,
      baseUrl: ollamaBaseUrl,
      reachable: ollamaLive.reachable,
      modelFound: ollamaLive.modelFound,
      modelsAvailable: ollamaLive.modelsAvailable,
      error: ollamaLive.error,
      capabilities: {
        scriptPlanning: true,
        voiceCasting: true,
        soundDesign: true,
      },
    },
  };
};

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

export const validateVoiceChangerRequest = (request) => {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) return "Voice changer expects multipart/form-data audio upload.";
  return null;
};

const outputQuery = (outputFormat) => (isNonEmptyString(outputFormat) ? `?output_format=${encodeURIComponent(outputFormat)}` : "");

export const buildElevenLabsUrl = (path, outputFormat) => `${ELEVENLABS_API_BASE}${path}${outputQuery(outputFormat)}`;

export const normalizeElevenLabsVoices = (payload, source = "elevenlabs") => {
  const voices = Array.isArray(payload?.voices) ? payload.voices : [];
  return voices.map((voice) => ({
    voiceId: String(voice.voice_id ?? voice.voiceId ?? ""),
    name: String(voice.name ?? "Untitled voice"),
    category: voice.category ? String(voice.category) : undefined,
    description: voice.description ? String(voice.description) : undefined,
    previewUrl: voice.preview_url ? String(voice.preview_url) : voice.previewUrl ? String(voice.previewUrl) : undefined,
    labels: voice.labels && typeof voice.labels === "object" ? voice.labels : {},
    source,
  })).filter((voice) => voice.voiceId);
};

const forwardElevenLabsResponse = async (providerResponse, response, fallbackContentType = "audio/mpeg", requestOrigin) => {
  const contentType = providerResponse.headers.get("content-type") ?? fallbackContentType;
  const passThroughHeaders = {
    "Content-Type": contentType,
    ...corsHeaders(requestOrigin),
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
    }, requestOrigin);
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

export const handleElevenLabsVoices = async (_request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 200, {
      source: "mock",
      warning: "ELEVENLABS_API_KEY is not configured. Returning mock voice options for local demo work.",
      voices: mockElevenLabsVoices,
    }, requestOrigin);
  }

  const providerResponse = await fetch(buildElevenLabsUrl("/voices"), {
    method: "GET",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });

  if (!providerResponse.ok) {
    const contentType = providerResponse.headers.get("content-type") ?? "";
    const detail = contentType.includes("application/json") ? await providerResponse.json() : await providerResponse.text();
    return json(response, providerResponse.status, {
      error: "ElevenLabs voice catalog request failed.",
      status: providerResponse.status,
      detail,
    }, requestOrigin);
  }

  const payload = await providerResponse.json();
  return json(response, 200, { source: "elevenlabs", voices: normalizeElevenLabsVoices(payload) }, requestOrigin);
};

export const handleElevenLabsPreview = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, {
      error: "ELEVENLABS_API_KEY is not configured.",
      fallback: "Use MockVoiceProvider in the frontend until credentials are available.",
    }, requestOrigin);
  }

  const body = await readJson(request);
  const validationError = validateVoiceRequest(body);
  if (validationError) return json(response, 400, { error: validationError }, requestOrigin);

  const voiceId = body.voiceId ?? env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!voiceId) {
    return json(response, 400, {
      error: "No voiceId supplied and ELEVENLABS_DEFAULT_VOICE_ID is not configured.",
    }, requestOrigin);
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
  return forwardElevenLabsResponse(providerResponse, response, "audio/mpeg", requestOrigin);
};

export const handleElevenLabsSoundEffect = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, { error: "ELEVENLABS_API_KEY is not configured.", fallback: "Use mock sound design cues until credentials are available." }, requestOrigin);
  }
  const body = await readJson(request);
  const validationError = validateSoundEffectRequest(body);
  if (validationError) return json(response, 400, { error: validationError }, requestOrigin);
  const providerResponse = await elevenLabsJsonRequest({
    env, path: "/sound-generation", outputFormat: body.outputFormat ?? "mp3_44100_128",
    body: { text: body.text, loop: body.loop ?? false, duration_seconds: body.durationSeconds, prompt_influence: body.promptInfluence ?? 0.3, model_id: body.modelId ?? "eleven_text_to_sound_v2" },
  });
  return forwardElevenLabsResponse(providerResponse, response, "audio/mpeg", requestOrigin);
};

export const handleElevenLabsMusic = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, { error: "ELEVENLABS_API_KEY is not configured.", fallback: "Use planned music cue sheets until credentials are available." }, requestOrigin);
  }
  const body = await readJson(request);
  const validationError = validateMusicRequest(body);
  if (validationError) return json(response, 400, { error: validationError }, requestOrigin);
  const providerResponse = await elevenLabsJsonRequest({
    env, path: "/music", outputFormat: body.outputFormat ?? "mp3_44100_128",
    body: { prompt: body.prompt, composition_plan: body.compositionPlan, music_length_ms: body.musicLengthMs, model_id: body.modelId ?? "music_v1", seed: body.seed, force_instrumental: body.forceInstrumental ?? true, respect_sections_durations: body.respectSectionsDurations ?? true, sign_with_c2pa: body.signWithC2pa ?? true },
  });
  return forwardElevenLabsResponse(providerResponse, response, "audio/mpeg", requestOrigin);
};

export const handleElevenLabsDubbing = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, { error: "ELEVENLABS_API_KEY is not configured.", fallback: "Export dubbing notes and source scripts until credentials are available." }, requestOrigin);
  }
  const body = await readJson(request);
  const validationError = validateDubbingRequest(body);
  if (validationError) return json(response, 400, { error: validationError }, requestOrigin);
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
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    body: form,
  });
  if (!providerResponse.ok) return forwardElevenLabsResponse(providerResponse, response, "application/json", requestOrigin);
  const payload = await providerResponse.json();
  return json(response, 200, payload, requestOrigin);
};

export const handleElevenLabsDubbingStatus = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, { error: "ELEVENLABS_API_KEY is not configured." }, requestOrigin);
  }
  const url = new URL(request.url, "http://127.0.0.1");
  const dubbingId = url.searchParams.get("dubbingId");
  if (!dubbingId) {
    return json(response, 400, { error: "Missing required dubbingId query parameter." }, requestOrigin);
  }
  const providerResponse = await fetch(buildElevenLabsUrl(`/dubbing/${encodeURIComponent(dubbingId)}`), {
    method: "GET",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });
  if (!providerResponse.ok) return forwardElevenLabsResponse(providerResponse, response, "application/json", requestOrigin);
  const payload = await providerResponse.json();
  return json(response, 200, payload, requestOrigin);
};

export const handleElevenLabsDubbingAudio = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, { error: "ELEVENLABS_API_KEY is not configured." }, requestOrigin);
  }
  const url = new URL(request.url, "http://127.0.0.1");
  const dubbingId = url.searchParams.get("dubbingId");
  const lang = url.searchParams.get("lang");
  if (!dubbingId || !lang) {
    return json(response, 400, { error: "Missing required dubbingId or lang query parameters." }, requestOrigin);
  }
  const providerResponse = await fetch(buildElevenLabsUrl(`/dubbing/${encodeURIComponent(dubbingId)}/audio/${encodeURIComponent(lang)}`), {
    method: "GET",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });
  return forwardElevenLabsResponse(providerResponse, response, "audio/mpeg", requestOrigin);
};

export const handleElevenLabsVoiceChanger = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, { error: "ELEVENLABS_API_KEY is not configured.", fallback: "Use mock voice takes until credentials are available." }, requestOrigin);
  }
  const validationError = validateVoiceChangerRequest(request);
  if (validationError) return json(response, 400, { error: validationError }, requestOrigin);
  const url = new URL(request.url, "http://127.0.0.1");
  const voiceId = url.searchParams.get("voiceId") ?? env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!voiceId) {
    return json(response, 400, { error: "No voiceId supplied and ELEVENLABS_DEFAULT_VOICE_ID is not configured." }, requestOrigin);
  }
  const outputFormat = url.searchParams.get("outputFormat") ?? "mp3_44100_128";
  const providerResponse = await fetch(buildElevenLabsUrl(`/speech-to-speech/${encodeURIComponent(voiceId)}`, outputFormat), {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": request.headers["content-type"] },
    body: request,
    duplex: "half",
  });
  return forwardElevenLabsResponse(providerResponse, response, "audio/mpeg", requestOrigin);
};

export const handleRivaPreview = async (request, response, env = process.env, requestOrigin = "") => {
  if (!(env.NVIDIA_RIVA_ENDPOINT && env.NVIDIA_RIVA_API_KEY)) {
    return json(response, 401, { error: "NVIDIA_RIVA_ENDPOINT and NVIDIA_RIVA_API_KEY are not configured.", fallback: "Use MockVoiceProvider in the frontend until credentials are available." }, requestOrigin);
  }
  const body = await readJson(request);
  const validationError = validateVoiceRequest(body);
  if (validationError) return json(response, 400, { error: validationError }, requestOrigin);
  return json(response, 501, {
    error: "NVIDIA Riva synthesis is not enabled in this scaffold yet.",
    nextStep: "Connect the configured Riva endpoint with SSML, streaming, and pronunciation dictionary support.",
    requestAccepted: { textLength: body.text.length, ssml: Boolean(body.ssml), endpointConfigured: true },
  }, requestOrigin);
};

/**
 * POST /api/voice/elevenlabs/full-spot
 * Body: { lines: [{ text, voiceId?, voiceSettings?, pauseAfterMs? }] }
 * Generates each line via ElevenLabs TTS then concatenates all MP3s into one file.
 * Returns: audio/mpeg
 */
export const handleElevenLabsFullSpot = async (request, response, env = process.env, requestOrigin = "") => {
  if (!env.ELEVENLABS_API_KEY) {
    return json(response, 401, {
      error: "ELEVENLABS_API_KEY is not configured.",
      fallback: "Add the key to .env and restart npm run server.",
    }, requestOrigin);
  }

  const body = await readJson(request);
  if (!body?.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
    return json(response, 400, { error: "lines array is required." }, requestOrigin);
  }
  if (body.lines.length > 40) {
    return json(response, 400, { error: "Max 40 lines per full-spot render." }, requestOrigin);
  }

  const defaultVoiceId = env.ELEVENLABS_DEFAULT_VOICE_ID;
  const silenceBuffer = (ms) => {
    // Build a minimal silent MP3 frame for padding between lines
    // 128 kbps MP3 = 16000 bytes/sec → ms * 16 bytes per ms (approx)
    const byteCount = Math.max(0, Math.floor(ms * 16));
    return Buffer.alloc(byteCount, 0xff); // near-silent padding
  };

  const chunks = [];
  for (const line of body.lines) {
    const text = String(line.text ?? "").trim();
    if (!text) continue;

    const voiceId = line.voiceId ?? defaultVoiceId;
    if (!voiceId) {
      return json(response, 400, {
        error: `No voiceId for line "${text.slice(0, 40)}..." and ELEVENLABS_DEFAULT_VOICE_ID is not set.`,
      }, requestOrigin);
    }

    try {
      const providerResponse = await elevenLabsJsonRequest({
        env,
        path: `/text-to-speech/${encodeURIComponent(voiceId)}`,
        outputFormat: "mp3_44100_128",
        body: {
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: line.voiceSettings ?? { stability: 0.55, similarity_boost: 0.78, style: 0.08, use_speaker_boost: true },
          apply_text_normalization: "auto",
        },
      });

      if (!providerResponse.ok) {
        const detail = await providerResponse.text();
        return json(response, providerResponse.status, {
          error: `ElevenLabs failed for line "${text.slice(0, 40)}..."`,
          detail: detail.slice(0, 300),
        }, requestOrigin);
      }

      const audioBuffer = Buffer.from(await providerResponse.arrayBuffer());
      chunks.push(audioBuffer);

      // Add silence padding between lines
      const pauseMs = Number(line.pauseAfterMs ?? 300);
      if (pauseMs > 0) chunks.push(silenceBuffer(pauseMs));

    } catch (error) {
      return json(response, 502, {
        error: `Network error generating line "${text.slice(0, 40)}..."`,
        detail: error instanceof Error ? error.message : "Unknown error",
      }, requestOrigin);
    }
  }

  if (chunks.length === 0) {
    return json(response, 400, { error: "No audio was generated. Check that lines have text." }, requestOrigin);
  }

  const combined = Buffer.concat(chunks);
  response.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Disposition": `attachment; filename="full-spot.mp3"`,
    "Content-Length": combined.length,
    ...corsHeaders(requestOrigin),
  });
  response.end(combined);
};

const llmSystemPrompt = "You are a senior radio/audio creative director and sound designer. Return only valid JSON. No markdown. " +
  "Given ANY text input (a product description, a concept, a sentence, a topic — anything), you must autonomously decide: " +
  "1) The full conversation/script structure — who speaks, how many voices, what characters, what tone and emotion for each line. " +
  "2) Where sound effects should be placed — be extremely specific with SFX prompts for ElevenLabs generation (describe the exact sound). " +
  "3) Where music should play — style, mood, tempo, instrumentation, and exact timing. " +
  "4) A sonic logo/brand mnemonic — always include one as a sound cue with type 'brand-mnemonic'. Make the sfxMoment a detailed ElevenLabs prompt for a 2-3 second distinctive sonic signature. " +
  "5) Voice casting — describe each role with accent, age range, pace, emotional style, and performance direction. " +
  "6) Mix notes — how voice, SFX, and music should be balanced. " +
  "Rules: " +
  "- ALWAYS include at least one sound effect cue that enhances the storytelling. " +
  "- ALWAYS include a music bed that supports the emotional arc. " +
  "- ALWAYS include a sonic logo/brand mnemonic sound cue at the end (type brand-mnemonic in scriptLines, plus a matching soundCue with a detailed ElevenLabs-ready prompt). " +
  "- Sound effect sfxMoment values must be highly descriptive ElevenLabs prompts (e.g. 'a warm coffee pour with gentle steam rising, ceramic cup on wooden table' not just 'coffee sound'). " +
  "- Music prompts must specify genre, mood, instruments, tempo, and energy level. " +
  "- Script should have natural pauses, emotional shifts, and clear performance direction. " +
  "- Each voice role must be distinct and well-characterized. " +
  "JSON shape: {\"title\":\"string\",\"scriptLines\":[{\"speaker\":\"ANNOUNCER|VO1|VO2|CHARACTER_NAME|SFX|MUSIC|SONIC_LOGO\",\"type\":\"voiceover|announcer|character|dialogue|sound-effect|music|pause|legal|cta|brand-mnemonic|note\",\"text\":\"string\",\"performanceNote\":\"string\",\"assignedVoiceRoleName\":\"string optional\"}],\"voiceRoles\":[{\"roleName\":\"string\",\"characterDescription\":\"string\",\"ageRange\":\"string\",\"accent\":\"string\",\"emotionalStyle\":\"string\",\"pace\":\"slow|measured|conversational|quick|fast-read\",\"performanceNotes\":\"string\",\"pronunciationNotes\":\"string\",\"elevenLabsSearchQuery\":\"string\"}],\"soundCues\":[{\"lineNumber\":1,\"label\":\"string\",\"location\":\"string\",\"texture\":\"string\",\"sfxMoment\":\"detailed ElevenLabs sound generation prompt\",\"foley\":\"string\",\"startTime\":0,\"endTime\":2,\"notes\":\"string\"}],\"musicCues\":[{\"label\":\"string\",\"style\":\"string\",\"tempo\":\"string\",\"instrumentation\":\"string\",\"mood\":\"string\",\"startTime\":0,\"endTime\":30,\"notes\":\"string\",\"elevenLabsMusicPrompt\":\"full descriptive prompt for ElevenLabs music generation\"}],\"mixNotes\":\"string\"}";

const extractJsonObject = (value) => {
  const text = String(value ?? "").trim();
  try { return JSON.parse(text); } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("Ollama response did not contain a JSON object.");
  }
};

const normalizeLlmPlan = (plan) => ({
  title: String(plan?.title ?? "AI generated audio script"),
  scriptLines: Array.isArray(plan?.scriptLines) ? plan.scriptLines : [],
  voiceRoles: Array.isArray(plan?.voiceRoles) ? plan.voiceRoles : [],
  soundCues: Array.isArray(plan?.soundCues) ? plan.soundCues : [],
  musicCues: Array.isArray(plan?.musicCues) ? plan.musicCues : [],
  mixNotes: String(plan?.mixNotes ?? ""),
});

export const handleLlmProductionPlan = async (request, response, env = process.env, requestOrigin = "") => {
  const ollamaBase = env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = env.OLLAMA_MODEL || "llama3";
  const body = await readJson(request);
  const input = String(body.input ?? "").trim();
  if (!input) return json(response, 400, { error: "Missing required input." }, requestOrigin);
  if (input.length > 6000) return json(response, 400, { error: "Input is too long. Keep the brief under 6000 characters." }, requestOrigin);
  const brief = body.brief && typeof body.brief === "object" ? body.brief : {};
  const targetDuration = Number(body.targetDuration ?? brief.targetDuration ?? 30);
  const voiceCatalog = Array.isArray(body.voiceCatalog) ? body.voiceCatalog.slice(0, 80) : [];
  const userPrompt = JSON.stringify({
    task: "From the input below, autonomously create a COMPLETE audio production. YOU decide everything: the script structure, who speaks (how many voices, what characters), where sound effects go, where music plays, and include a sonic logo. Make it broadcast-ready.",
    productionInput: input,
    targetDurationSeconds: Number.isFinite(targetDuration) ? targetDuration : 30,
    brief,
    availableElevenLabsVoices: voiceCatalog.map((voice) => ({ voiceId: voice.voiceId, name: voice.name, description: voice.description, labels: voice.labels })),
    instructions: [
      "Decide the conversation structure autonomously — how many speakers, what they say, the emotional arc.",
      "Place sound effects at moments that enhance storytelling (opening hooks, transitions, environmental sounds).",
      "Design a music bed with specific ElevenLabs-ready prompt describing genre, instruments, mood, tempo.",
      "Include a sonic logo / brand mnemonic as BOTH a scriptLine (type: brand-mnemonic) AND a soundCue with a detailed sfxMoment prompt for ElevenLabs to generate a 2-3 second audio signature.",
      "Each soundCue sfxMoment must be a rich, descriptive prompt that ElevenLabs can use to generate the exact sound (not just a label).",
      "If a voice catalog is present, match voice role descriptions to available voices. Do not invent provider voice ids.",
      "Every scriptLine that is spoken must have an assignedVoiceRoleName matching one of the voiceRoles.",
      "Include performance notes for every spoken line — emotion, pace, delivery style.",
    ]
  });
  const ollamaTimeoutMs = 6 * 60 * 1000; // Observed successful generations taking ~110-120s on CPU-only hardware; give real margin above that.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaTimeoutMs);
  try {
    console.log(`[llm] Sending production-plan request to Ollama at ${ollamaBase} (model: ${model})...`);
    const startedAt = Date.now();
    const providerResponse = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: llmSystemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        // num_predict trimmed from 4096: a 30-60s ad plan rarely needs more than ~1600 tokens, and every
        // unused token in the ceiling is time spent generating. format:"json" (grammar-constrained decoding)
        // was removed because it can slow local models down by 10x+ per token on CPU-only hardware; the
        // system prompt already demands raw JSON, and extractJsonObject() below has a tolerant fallback parser.
        options: { temperature: 0.7, num_predict: 1600 },
      }),
      signal: controller.signal,
    });
    console.log(`[llm] Ollama responded with status ${providerResponse.status} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    if (!providerResponse.ok) {
      const detail = await providerResponse.text();
      return json(response, providerResponse.status, { error: "Ollama Llama 3 production planning failed.", detail }, requestOrigin);
    }
    const payload = await providerResponse.json();
    const text = payload?.message?.content ?? "";
    try { return json(response, 200, normalizeLlmPlan(extractJsonObject(text)), requestOrigin); } catch (error) {
      return json(response, 502, { error: "Could not parse Ollama Llama 3 production plan JSON.", detail: error instanceof Error ? error.message : "Unknown parse error", raw: text.slice(0, 1200) }, requestOrigin);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.log(`[llm] Ollama request timed out after ${ollamaTimeoutMs / 1000}s.`);
      return json(response, 504, {
        error: `Ollama did not respond within ${ollamaTimeoutMs / 1000}s.`,
        detail: "The model may still be loading into memory on first use, or this machine is too slow to generate a full production plan quickly. Try running 'ollama run llama3 \"hello\"' directly in a terminal to see how fast this machine generates tokens.",
      }, requestOrigin);
    }
    console.log(`[llm] Could not reach Ollama: ${error instanceof Error ? error.message : error}`);
    return json(response, 502, { error: "Could not connect to Ollama. Make sure Ollama is running with Llama 3 loaded.", detail: error instanceof Error ? error.message : "Connection refused" }, requestOrigin);
  } finally {
    clearTimeout(timeout);
  }
};
export const createProviderProxyServer = (env = process.env) =>
  createServer(async (request, response) => {
  const requestOrigin = request.headers["origin"] ?? "";
  try {
    if (request.method === "OPTIONS") return json(response, 204, {}, requestOrigin);
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true, service: "Napkin Audio AI Studio provider proxy" }, requestOrigin);
    }
    if (request.method === "GET" && request.url === "/api/providers/status") {
      return json(response, 200, await providerStatus(env), requestOrigin);
    }
    if (request.method === "POST" && request.url === "/api/llm/production-plan") {
      return handleLlmProductionPlan(request, response, env, requestOrigin);
    }
    if (request.method === "GET" && request.url === "/api/voice/elevenlabs/voices") {
      return handleElevenLabsVoices(request, response, env, requestOrigin);
    }
    if (request.method === "POST" && request.url === "/api/voice/elevenlabs/preview") {
      return handleElevenLabsPreview(request, response, env, requestOrigin);
    }
    if (request.method === "POST" && request.url === "/api/voice/elevenlabs/full-spot") {
      return handleElevenLabsFullSpot(request, response, env, requestOrigin);
    }
    if (request.method === "POST" && request.url === "/api/sound/elevenlabs/effect") {
      return handleElevenLabsSoundEffect(request, response, env, requestOrigin);
    }
    if (request.method === "POST" && request.url === "/api/music/elevenlabs/compose") {
      return handleElevenLabsMusic(request, response, env, requestOrigin);
    }
    if (request.method === "POST" && request.url === "/api/dubbing/elevenlabs/create") {
      const contentType = request.headers["content-type"] ?? "";
      if (contentType.includes("multipart/form-data")) {
        if (!env.ELEVENLABS_API_KEY) {
          return json(response, 401, { error: "ELEVENLABS_API_KEY is not configured." }, requestOrigin);
        }
        const providerResponse = await fetch(buildElevenLabsUrl("/dubbing"), {
          method: "POST",
          headers: {
            "xi-api-key": env.ELEVENLABS_API_KEY,
            "Content-Type": request.headers["content-type"],
          },
          body: request,
          duplex: "half",
        });
        if (!providerResponse.ok) return forwardElevenLabsResponse(providerResponse, response, "application/json", requestOrigin);
        const payload = await providerResponse.json();
        return json(response, 200, payload, requestOrigin);
      } else {
        return handleElevenLabsDubbing(request, response, env, requestOrigin);
      }
    }
    if (request.method === "GET" && request.url?.startsWith("/api/dubbing/elevenlabs/status")) {
      return handleElevenLabsDubbingStatus(request, response, env, requestOrigin);
    }
    if (request.method === "GET" && request.url?.startsWith("/api/dubbing/elevenlabs/audio")) {
      return handleElevenLabsDubbingAudio(request, response, env, requestOrigin);
    }
    if (request.method === "POST" && request.url?.startsWith("/api/voice/elevenlabs/voice-changer")) {
      return handleElevenLabsVoiceChanger(request, response, env, requestOrigin);
    }
    if (request.method === "POST" && request.url === "/api/voice/riva/preview") {
      return handleRivaPreview(request, response, env, requestOrigin);
    }
    return json(response, 404, { error: "Not found" }, requestOrigin);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      return json(response, 400, { error: error.message }, requestOrigin);
    }
    return json(response, 500, {
      error: "Provider proxy error",
      detail: error instanceof Error ? error.message : "Unknown error",
    }, requestOrigin);
  }
  });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadLocalEnv(resolve(process.cwd(), ".env"), process.env, { override: true });
  const server = createProviderProxyServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Napkin Audio AI Studio provider proxy listening on http://127.0.0.1:${port}`);
  });
}
