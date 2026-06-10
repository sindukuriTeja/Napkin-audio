import { createId, nowIso } from "../lib/id";
import type { VoiceProviderConfig, VoiceTake } from "../types/models";

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
  if (config.provider === "elevenlabs" && config.apiKey) return new ElevenLabsProvider(config);
  if (config.provider === "nvidia-riva" && config.endpoint && config.apiKey) return new NvidiaRivaProvider(config);
  return new MockVoiceProvider();
};
