import { describe, expect, it } from "vitest";
import { ComplianceAgent, ScriptParserAgent } from "./studioAgents";
import { createProject, recomputeProject, updateScriptFromText } from "../data/sampleProject";

describe("ScriptParserAgent", () => {
  it("parses common radio script cues into typed lines and timings", () => {
    const script = ScriptParserAgent.parse(
      `SFX: Doorbell rings
ANNOUNCER: Visit Napkin today.
LEGAL: Subject to availability. Terms apply.
MNEMONIC: Napkin. Sorted.`,
      30,
    );

    expect(script.lines).toHaveLength(4);
    expect(script.lines.map((line) => line.type)).toEqual(["sound-effect", "cta", "legal", "brand-mnemonic"]);
    expect(script.estimatedDuration).toBeGreaterThan(0);
    expect(script.wordsPerSecond).toBeGreaterThan(0);
    expect(script.lines[2].performanceNote).toContain("legal");
  });

  it("detects numbered voiceovers, brand voice, brown voice, and mnemonics", () => {
    const script = ScriptParserAgent.parse(
      `VOICEOVER 1: The morning starts softly.
VO 2: Then the second voice answers.
VOICEOVER 3: A third voice is rare, but possible.
BRAND VOICE: Napkin Fresh.
BROWN VOICE: A defensive spelling we still treat as brand voice.
MNEMONIC: Napkin Fresh. Sorted.`,
      30,
    );

    expect(script.lines.map((line) => line.type)).toEqual([
      "voiceover",
      "voiceover",
      "voiceover",
      "brand-mnemonic",
      "brand-mnemonic",
      "brand-mnemonic",
    ]);
    expect(script.lines.map((line) => line.speaker)).toEqual(["VOICEOVER 1", "VO 2", "VOICEOVER 3", "BRAND VOICE", "BROWN VOICE", "MNEMONIC"]);
  });
});

describe("Craft Quality and QC", () => {
  it("generates a Craft Quality score with required sub-scores", () => {
    const project = createProject();

    expect(project.craftQuality.overallScore).toBeGreaterThan(0);
    expect(project.craftQuality.subScores).toHaveLength(11);
    expect(project.craftQuality.recommendation).toBeTruthy();
    expect(project.craftQuality.nextBestCraftMove).toBeTruthy();
  });

  it("never passes human approval until the user explicitly approves broadcast", () => {
    const project = createProject();
    const approvalCheck = project.qcResults.find((result) => result.check === "Human approval");

    expect(approvalCheck?.status).toBe("fail");

    const approvedResults = ComplianceAgent.runQc({ ...project, approvalStatus: "Approved for broadcast" });
    expect(approvedResults.find((result) => result.check === "Human approval")?.status).toBe("pass");
  });

  it("fails missing mandatory phrases instead of silently assuming compliance", () => {
    const project = createProject();
    const updated = updateScriptFromText(project, "ANNOUNCER: A script with no required brand language.");
    const mandatoryCheck = updated.qcResults.find((result) => result.check === "Mandatory lines");

    expect(mandatoryCheck?.status).toBe("fail");
  });

  it("creates distinct casting roles for detected VO lanes and brand mnemonic lines", () => {
    const project = createProject();
    const updated = updateScriptFromText(
      project,
      `VOICEOVER 1: The morning starts softly.
VO 2: Then the second voice answers.
VOICEOVER 3: A third voice is rare, but possible.
BROWN VOICE: Napkin Fresh.
MNEMONIC: Napkin Fresh. Sorted.`,
    );

    expect(updated.voiceRoles.map((role) => role.id)).toEqual(
      expect.arrayContaining(["voice-voiceover-1", "voice-voiceover-2", "voice-voiceover-3", "voice-brand"]),
    );
    expect(updated.script.lines.find((line) => line.speaker === "VOICEOVER 1")?.assignedVoiceRoleId).toBe("voice-voiceover-1");
    expect(updated.script.lines.find((line) => line.speaker === "VO 2")?.assignedVoiceRoleId).toBe("voice-voiceover-2");
    expect(updated.script.lines.find((line) => line.speaker === "VOICEOVER 3")?.assignedVoiceRoleId).toBe("voice-voiceover-3");
    expect(updated.script.lines.find((line) => line.speaker === "BROWN VOICE")?.assignedVoiceRoleId).toBe("voice-brand");
    expect(updated.script.lines.find((line) => line.speaker === "MNEMONIC")?.assignedVoiceRoleId).toBe("voice-brand");
  });

  it("can refresh derived state without creating a version-history entry", () => {
    const project = createProject();
    const refreshed = recomputeProject(project, "Loaded saved browser project", { trackVersion: false });

    expect(refreshed.versionHistory).toHaveLength(project.versionHistory.length);
    expect(refreshed.craftQuality.overallScore).toBeGreaterThan(0);
  });
});
