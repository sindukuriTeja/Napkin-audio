import { describe, expect, it } from "vitest";
import { ComplianceAgent, ScriptParserAgent } from "./studioAgents";
import { createProject, updateScriptFromText } from "../data/sampleProject";

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
});
