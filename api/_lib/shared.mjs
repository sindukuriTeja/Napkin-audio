const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

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

export const corsHeaders = (requestOrigin) => ({
  "Access-Control-Allow-Origin": requestOrigin || "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Content-Type,Content-Length,character-cost,request-id,history-item-id,song-id",
  "Vary": "Origin",
});

export const buildElevenLabsUrl = (path, outputFormat) => {
  const query = outputFormat ? `?output_format=${encodeURIComponent(outputFormat)}` : "";
  return `${ELEVENLABS_API_BASE}${path}${query}`;
};

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
