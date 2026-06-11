import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderStatus, generateElevenLabsSpeechPreview, providerProxyBaseUrl } from "./providerProxy";

describe("frontend provider proxy service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("generates an ElevenLabs speech preview through the server proxy", async () => {
    const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => audioBlob,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateElevenLabsSpeechPreview({ text: "Read this line", voiceId: "voice-123" })).resolves.toBe(audioBlob);
    expect(fetchMock).toHaveBeenCalledWith(
      `${providerProxyBaseUrl}/api/voice/elevenlabs/preview`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("voice-123"),
      }),
    );
  });

  it("surfaces provider errors from JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "ELEVENLABS_API_KEY is not configured." }),
      }),
    );

    await expect(generateElevenLabsSpeechPreview({ text: "Read this line" })).rejects.toThrow("ELEVENLABS_API_KEY is not configured.");
  });
});
