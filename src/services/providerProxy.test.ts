import { describe, expect, it, vi } from "vitest";
import { fetchProviderStatus, providerProxyBaseUrl } from "./providerProxy";

describe("frontend provider proxy service", () => {
  it("fetches provider status from the configured proxy URL", async () => {
    const status = {
      elevenLabs: {
        configured: true,
        defaultVoiceIdConfigured: false,
        capabilities: { speech: true, soundEffects: true, music: true, dubbing: true, voiceChanger: true },
      },
      nvidiaRiva: { configured: false, endpointConfigured: false },
      nvidiaNim: { configured: false },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => status,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProviderStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(`${providerProxyBaseUrl}/api/providers/status`);
  });

  it("throws when the provider proxy is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(fetchProviderStatus()).rejects.toThrow("Provider proxy returned 503");
  });
});
