import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildElevenLabsUrl,
  loadLocalEnv,
  providerStatus,
  validateDubbingRequest,
  validateMusicRequest,
  validateSoundEffectRequest,
  validateVoiceRequest,
} from "./provider-proxy.mjs";

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
        capabilities: {
          speech: true,
          soundEffects: true,
          music: true,
          dubbing: true,
        },
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

  it("validates ElevenLabs sound effect requests", () => {
    expect(validateSoundEffectRequest({ text: "" })).toBe("Missing required sound effect prompt text.");
    expect(validateSoundEffectRequest({ text: "Door slam", durationSeconds: 0.1 })).toBe(
      "durationSeconds must be between 0.5 and 30.",
    );
    expect(validateSoundEffectRequest({ text: "Door slam", promptInfluence: 2 })).toBe(
      "promptInfluence must be between 0 and 1.",
    );
    expect(validateSoundEffectRequest({ text: "Door slam", durationSeconds: 1.5 })).toBeNull();
  });

  it("validates ElevenLabs music requests", () => {
    expect(validateMusicRequest({})).toBe("Missing prompt or compositionPlan.");
    expect(validateMusicRequest({ prompt: "Sparse Irish radio bed", compositionPlan: {} })).toBe(
      "Use prompt or compositionPlan, not both.",
    );
    expect(validateMusicRequest({ prompt: "Sparse Irish radio bed", musicLengthMs: 1000 })).toBe(
      "musicLengthMs must be between 3000 and 600000.",
    );
    expect(validateMusicRequest({ prompt: "Sparse Irish radio bed", musicLengthMs: 30000 })).toBeNull();
  });

  it("validates URL-based ElevenLabs dubbing requests", () => {
    expect(validateDubbingRequest({ sourceUrl: "https://example.com/audio.mp3" })).toBe("Missing required targetLang.");
    expect(validateDubbingRequest({ targetLang: "fr" })).toBe(
      "This proxy route currently supports sourceUrl JSON requests only.",
    );
    expect(validateDubbingRequest({ targetLang: "fr", sourceUrl: "notaurl" })).toBe("sourceUrl must be a valid URL.");
    expect(validateDubbingRequest({ targetLang: "fr", sourceUrl: "https://example.com/audio.mp3" })).toBeNull();
  });

  it("builds ElevenLabs API URLs without exposing credentials", () => {
    expect(buildElevenLabsUrl("/music", "mp3_44100_128")).toBe(
      "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    );
    expect(buildElevenLabsUrl("/dubbing")).toBe("https://api.elevenlabs.io/v1/dubbing");
  });

  it("loads local .env values without overwriting existing environment values", () => {
    const dir = mkdtempSync(join(tmpdir(), "napkin-ai-audio-studio-env-"));
    const envPath = join(dir, ".env");
    const env = { ELEVENLABS_API_KEY: "already-set" };
    writeFileSync(
      envPath,
      [
        "ELEVENLABS_API_KEY=from-file",
        "ELEVENLABS_DEFAULT_VOICE_ID='voice-from-file'",
        "CORS_ORIGIN=\"http://127.0.0.1:5173\"",
      ].join("\n"),
    );

    try {
      expect(loadLocalEnv(envPath, env)).toEqual(["ELEVENLABS_DEFAULT_VOICE_ID", "CORS_ORIGIN"]);
      expect(env).toEqual({
        ELEVENLABS_API_KEY: "already-set",
        ELEVENLABS_DEFAULT_VOICE_ID: "voice-from-file",
        CORS_ORIGIN: "http://127.0.0.1:5173",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can let local .env values override inherited shell values for the dev server", () => {
    const dir = mkdtempSync(join(tmpdir(), "napkin-ai-audio-studio-env-"));
    const envPath = join(dir, ".env");
    const env = { ELEVENLABS_API_KEY: "invalid-inherited-key" };
    writeFileSync(envPath, "ELEVENLABS_API_KEY=real-local-key\n");

    try {
      expect(loadLocalEnv(envPath, env, { override: true })).toEqual(["ELEVENLABS_API_KEY"]);
      expect(env.ELEVENLABS_API_KEY).toBe("real-local-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
