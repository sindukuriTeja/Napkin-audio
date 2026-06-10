import { describe, expect, it } from "vitest";
import { providerStatus, validateVoiceRequest } from "./provider-proxy.mjs";

describe("provider proxy helpers", () => {
  it("reports provider configuration without exposing secrets", () => {
    const status = providerStatus({
      ELEVENLABS_API_KEY: "secret-key",
      ELEVENLABS_DEFAULT_VOICE_ID: "",
      NVIDIA_RIVA_ENDPOINT: "https://riva.example",
      NVIDIA_RIVA_API_KEY: "riva-secret",
      NVIDIA_NIM_API_KEY: "",
    });

    expect(status).toEqual({
      elevenLabs: {
        configured: true,
        defaultVoiceIdConfigured: false,
      },
      nvidiaRiva: {
        configured: true,
        endpointConfigured: true,
      },
      nvidiaNim: {
        configured: false,
      },
    });
    expect(JSON.stringify(status)).not.toContain("secret-key");
    expect(JSON.stringify(status)).not.toContain("riva-secret");
  });

  it("validates preview requests before provider work starts", () => {
    expect(validateVoiceRequest(undefined)).toBe("Expected a JSON body.");
    expect(validateVoiceRequest({ text: "" })).toBe("Missing required text.");
    expect(validateVoiceRequest({ text: "x".repeat(5001) })).toBe("Text is too long for a single preview request.");
    expect(validateVoiceRequest({ text: "A short line for preview." })).toBeNull();
  });
});
