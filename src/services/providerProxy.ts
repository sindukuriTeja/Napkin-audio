export interface ProviderStatus {
  elevenLabs: {
    configured: boolean;
    defaultVoiceIdConfigured: boolean;
    capabilities?: {
      speech: boolean;
      soundEffects: boolean;
      music: boolean;
      dubbing: boolean;
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
