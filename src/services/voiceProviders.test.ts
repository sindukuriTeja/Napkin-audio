import { describe, expect, it } from "vitest";
import { generateMockVoicePreviewBlob, MockVoiceProvider } from "./voiceProviders";

describe("voice providers", () => {
  it("creates mock take metadata without claiming real audio generation", async () => {
    const provider = new MockVoiceProvider();
    const take = await provider.generateTake({
      roleId: "voice-announcer",
      lineId: "line-1",
      text: "A short voiceover line.",
      performanceNotes: "Conversational.",
      takeNumber: 1,
    });

    expect(take.provider).toBe("mock");
    expect(take.isMock).toBe(true);
    expect(take.notes).toContain("No real audio");
  });

  it("creates a playable synthetic wav placeholder for mock previews", async () => {
    const blob = generateMockVoicePreviewBlob("A short voiceover line.");
    const header = new Uint8Array(await blob.arrayBuffer()).slice(0, 12);
    const headerText = String.fromCharCode(...header);

    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBeGreaterThan(44);
    expect(headerText).toContain("RIFF");
    expect(headerText).toContain("WAVE");
  });
});
