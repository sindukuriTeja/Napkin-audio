export interface ProviderStatus {
  elevenLabs: {
    configured: boolean;
    defaultVoiceIdConfigured: boolean;
    capabilities?: {
      speech: boolean;
      soundEffects: boolean;
      music: boolean;
      dubbing: boolean;
      voiceChanger?: boolean;
    };
  };
  nvidiaRiva: {
    configured: boolean;
    endpointConfigured: boolean;
  };
  nvidiaNim: {
    configured: boolean;
  };
  claude?: {
    configured: boolean;
    model: string;
    reachable?: boolean;
    modelFound?: boolean;
    error?: string | null;
    capabilities?: {
      scriptPlanning: boolean;
      voiceCasting: boolean;
      soundDesign: boolean;
    };
  };
}

export interface ProviderVoice {
  voiceId: string;
  name: string;
  category?: string;
  description?: string;
  previewUrl?: string;
  labels: Record<string, string>;
  source: "mock" | "elevenlabs";
}

// Three ways this gets resolved, in order:
// 1. VITE_PROVIDER_PROXY_URL set explicitly — for a split deployment where the
//    proxy runs on its own always-on host (Render, Railway, Fly.io) separate
//    from the static frontend.
// 2. Local dev (`npm run dev`) — defaults to the standalone proxy started by
//    `npm run server` on port 8787.
// 3. A built production bundle with no override — defaults to "" (a relative
//    path), which is correct when the proxy is deployed as Vercel serverless
//    functions alongside the frontend under the same domain (see
//    api/[...path].js): `${providerProxyBaseUrl}/api/...` then just resolves
//    to same-origin "/api/...".
export const providerProxyBaseUrl =
  import.meta.env.VITE_PROVIDER_PROXY_URL?.replace(/\/$/, "") ?? (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");

export const fetchProviderStatus = async (): Promise<ProviderStatus> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/providers/status`);
  if (!response.ok) {
    throw new Error(`Provider proxy returned ${response.status}`);
  }
  return response.json() as Promise<ProviderStatus>;
};

export const fetchElevenLabsVoices = async (): Promise<ProviderVoice[]> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/voice/elevenlabs/voices`);
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.voices)) return [];
  return payload.voices as ProviderVoice[];
};

export interface LlmProductionPlanLine {
  speaker?: string;
  type: string;
  text: string;
  performanceNote?: string;
  assignedVoiceRoleName?: string;
}

export interface LlmProductionVoiceRole {
  roleName: string;
  characterDescription: string;
  ageRange: string;
  accent: string;
  emotionalStyle: string;
  pace: "slow" | "measured" | "conversational" | "quick" | "fast-read";
  performanceNotes: string;
  pronunciationNotes?: string;
  elevenLabsSearchQuery?: string;
}

export interface LlmProductionSoundCue {
  lineNumber?: number;
  label: string;
  location: string;
  texture: string;
  sfxMoment: string;
  foley?: string;
  startTime?: number;
  endTime?: number;
  notes?: string;
}

export interface LlmProductionMusicCue {
  label: string;
  style: string;
  tempo: string;
  instrumentation: string;
  mood: string;
  startTime?: number;
  endTime?: number;
  notes?: string;
  elevenLabsMusicPrompt?: string;
}

export interface LlmProductionPlan {
  title: string;
  scriptLines: LlmProductionPlanLine[];
  voiceRoles: LlmProductionVoiceRole[];
  soundCues: LlmProductionSoundCue[];
  musicCues: LlmProductionMusicCue[];
  mixNotes: string;
}

export interface LlmProductionPlanRequest {
  input: string;
  brief: Record<string, unknown>;
  targetDuration: number;
  voiceCatalog?: ProviderVoice[];
}

export const generateLlmProductionPlan = async (input: LlmProductionPlanRequest): Promise<LlmProductionPlan> => {
  const controller = new AbortController();
  const timeoutMs = 2.5 * 60 * 1000; // Kept just above the backend's own Claude API timeout so the backend's clearer error wins the race.
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${providerProxyBaseUrl}/api/llm/production-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(await providerErrorMessage(response));
    }
    return response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Claude did not respond within ${timeoutMs / 1000}s. Check the "npm run server" terminal window for progress, or try a shorter description.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};
export interface ElevenLabsSpeechPreviewRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
}

const providerErrorMessage = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (payload && typeof payload === "object" && "error" in payload) {
      const base = String(payload.error);
      if ("detail" in payload && payload.detail) {
        const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
        return `${base} ${detail}`.slice(0, 600);
      }
      return base;
    }
  }
  const detail = await response.text();
  return detail || `Provider proxy returned ${response.status}`;
};

export const generateElevenLabsSpeechPreview = async (input: ElevenLabsSpeechPreviewRequest): Promise<Blob> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/voice/elevenlabs/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: input.text,
      voiceId: input.voiceId,
      modelId: input.modelId ?? "eleven_multilingual_v2",
      outputFormat: input.outputFormat ?? "mp3_44100_128",
      voiceSettings: input.voiceSettings,
    }),
  });
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  return response.blob();
};

export interface FullSpotLine {
  text: string;
  voiceId?: string;
  voiceSettings?: ElevenLabsSpeechPreviewRequest["voiceSettings"];
  pauseAfterMs?: number;
}

export const generateElevenLabsFullSpot = async (lines: FullSpotLine[]): Promise<Blob> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/voice/elevenlabs/full-spot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
  });
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  return response.blob();
};

// ElevenLabs currently ships a single Sound Effects model. Kept as a union (rather than a
// plain string) so a future "eleven_text_to_sound_v3" can be added here and it will show up
// as a real, working option in the Sound Design model picker in App.tsx.
export type ElevenLabsSoundEffectModel = "eleven_text_to_sound_v2";

export interface ElevenLabsSoundEffectRequest {
  text: string;
  durationSeconds?: number;
  promptInfluence?: number;
  modelId?: ElevenLabsSoundEffectModel;
}

export const generateElevenLabsSoundEffect = async (input: ElevenLabsSoundEffectRequest): Promise<Blob> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/sound/elevenlabs/effect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: input.text,
      durationSeconds: input.durationSeconds,
      promptInfluence: input.promptInfluence,
      modelId: input.modelId ?? "eleven_text_to_sound_v2",
    }),
  });
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  return response.blob();
};

// music_v1 is the long-standing default; music_v2 is ElevenLabs' newer flagship model with
// better prompt adherence, section-by-section composition, mid-track transitions, and
// embedded sound effects.
export type ElevenLabsMusicModel = "music_v1" | "music_v2";

export interface ElevenLabsMusicRequest {
  prompt: string;
  musicLengthMs?: number;
  modelId?: ElevenLabsMusicModel;
}

export const generateElevenLabsMusic = async (input: ElevenLabsMusicRequest): Promise<Blob> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/music/elevenlabs/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: input.prompt,
      musicLengthMs: input.musicLengthMs,
      modelId: input.modelId ?? "music_v1",
    }),
  });
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  return response.blob();
};

export interface ElevenLabsDubbingRequest {
  sourceUrl?: string;
  targetLang: string;
  sourceLang?: string;
  name?: string;
  targetAccent?: string;
  numSpeakers?: number;
  watermark?: boolean;
  startTime?: number;
  endTime?: number;
  dropBackgroundAudio?: boolean;
  disableVoiceCloning?: boolean;
}

export interface ElevenLabsDubbingJobResponse {
  dubbing_id: string;
  expected_duration_sec?: number;
}

export interface ElevenLabsDubbingStatusResponse {
  dubbing_id: string;
  name?: string;
  status: "dubbing" | "dubbed" | "failed";
  target_languages?: string[];
  error?: string;
}

export const createElevenLabsDubbingJob = async (input: ElevenLabsDubbingRequest): Promise<ElevenLabsDubbingJobResponse> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/dubbing/elevenlabs/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  return response.json();
};

export const checkElevenLabsDubbingStatus = async (dubbingId: string): Promise<ElevenLabsDubbingStatusResponse> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/dubbing/elevenlabs/status?dubbingId=${encodeURIComponent(dubbingId)}`);
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  return response.json();
};

export const fetchElevenLabsDubbingAudio = async (dubbingId: string, targetLang: string): Promise<Blob> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/dubbing/elevenlabs/audio?dubbingId=${encodeURIComponent(dubbingId)}&lang=${encodeURIComponent(targetLang)}`);
  if (!response.ok) {
    throw new Error(await providerErrorMessage(response));
  }
  return response.blob();
};
