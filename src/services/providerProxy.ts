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
}

export const providerProxyBaseUrl =
  import.meta.env.VITE_PROVIDER_PROXY_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8787";

export const fetchProviderStatus = async (): Promise<ProviderStatus> => {
  const response = await fetch(`${providerProxyBaseUrl}/api/providers/status`);
  if (!response.ok) {
    throw new Error(`Provider proxy returned ${response.status}`);
  }
  return response.json() as Promise<ProviderStatus>;
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
    if (payload && typeof payload === "object" && "error" in payload) return String(payload.error);
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
