import { createId, nowIso } from "../lib/id";
import type { VoiceProviderConfig, VoiceTake } from "../types/models";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const textHash = (value: string) =>
  value.split("").reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 2166136261);

export const generateMockVoicePreviewBlob = (text: string, overrideDuration?: number) => {
  const sampleRate = 8000;
  const calculated = 0.9 + text.trim().split(/\s+/).filter(Boolean).length * 0.035;
  const maxCap = overrideDuration ? Math.max(overrideDuration, 1) : 3.2;
  const durationSeconds = clamp(overrideDuration ?? calculated, 1, maxCap);
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + sampleCount * bytesPerSample);
  const view = new DataView(buffer);
  
  const basePitch = 130 + (textHash(text) % 90);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * bytesPerSample, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const cadence = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * time);
    const envelope = Math.min(1, time * 8) * Math.min(1, (durationSeconds - time) * 6) * cadence;
    
    const f0 = basePitch + Math.sin(2 * Math.PI * 1.5 * time) * 15;
    const h1 = Math.sin(2 * Math.PI * f0 * time) * 0.4;
    const h2 = Math.sin(2 * Math.PI * (f0 * 2) * time) * 0.2;
    const h3 = Math.sin(2 * Math.PI * (f0 * 3) * time) * 0.1;
    const voiceTone = (h1 + h2 + h3) * 0.6;

    view.setInt16(44 + index * bytesPerSample, Math.round(clamp(voiceTone * envelope, -1, 1) * 32767), true);
  }

  return new Blob([buffer], { type: "audio/wav" });
};

export const fetchSpokenTtsAudioBlob = async (text: string, langCode: string = "en"): Promise<Blob> => {
  try {
    const cleanLang = langCode.split("-")[0];
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${cleanLang}&client=tw-ob`;
    const response = await fetch(url);
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > 100) return blob;
    }
  } catch (err) {
    console.warn("TTS fetch notice:", err);
  }
  return generateMockVoicePreviewBlob(text);
};


export interface VoiceProvider {
  id: VoiceProviderConfig["provider"];
  label: string;
  canGenerate: boolean;
  generateTake(input: {
    roleId: string;
    lineId?: string;
    text: string;
    performanceNotes: string;
    takeNumber: number;
  }): Promise<VoiceTake>;
}

export class MockVoiceProvider implements VoiceProvider {
  id = "mock" as const;
  label = "Mock voice provider";
  canGenerate = true;

  async generateTake(input: {
    roleId: string;
    lineId?: string;
    text: string;
    performanceNotes: string;
    takeNumber: number;
  }): Promise<VoiceTake> {
    return {
      id: createId("take"),
      roleId: input.roleId,
      lineId: input.lineId,
      takeNumber: input.takeNumber,
      provider: "mock",
      settings: { textLength: input.text.length, mockOnly: true },
      performanceNotes: input.performanceNotes,
      isMock: true,
      isPreferred: false,
      notes: "Mock take record only. No real audio was generated.",
      createdAt: nowIso(),
    };
  }
}

export class ElevenLabsProvider implements VoiceProvider {
  id = "elevenlabs" as const;
  label = "ElevenLabs";
  canGenerate = false;

  constructor(private config: VoiceProviderConfig) {}

  async generateTake(): Promise<VoiceTake> {
    throw new Error(
      "ElevenLabs calls are disabled in the browser MVP. Add a backend proxy so API keys remain server-side.",
    );
  }

  get handoffCurl() {
    const voiceId = this.config.defaultVoiceId || "$ELEVENLABS_DEFAULT_VOICE_ID";
    return `curl -X POST https://api.elevenlabs.io/v1/text-to-speech/${voiceId} \\
  -H "xi-api-key: $ELEVENLABS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Your directed line here","model_id":"eleven_multilingual_v2"}'`;
  }
}

export class NvidiaRivaProvider implements VoiceProvider {
  id = "nvidia-riva" as const;
  label = "NVIDIA Riva";
  canGenerate = false;

  constructor(private config: VoiceProviderConfig) {}

  async generateTake(): Promise<VoiceTake> {
    throw new Error(
      "NVIDIA Riva generation is an adapter placeholder. Configure a secure endpoint and server-side proxy before use.",
    );
  }

  get adapterNotes() {
    return [
      "Support streaming and offline synthesis modes.",
      "Pass SSML and pronunciation dictionaries where available.",
      `Endpoint configured: ${this.config.endpoint ? "yes" : "no"}.`,
      "Keep API keys server-side.",
    ];
  }
}

export const getVoiceProvider = (config: VoiceProviderConfig): VoiceProvider => {
  if (config.provider === "elevenlabs") return new ElevenLabsProvider(config);
  if (config.provider === "nvidia-riva" && config.endpoint && config.apiKey) return new NvidiaRivaProvider(config);
  return new ElevenLabsProvider({ provider: "elevenlabs", defaultVoiceId: "XB0fDUnXU5powFXDhCwa" });
};
