import { describe, expect, it } from "vitest";
import { createProject } from "../data/sampleProject";
import { assignVoiceRolesToScript, voiceRoleIdForLine } from "./scriptRoles";

describe("script role assignment", () => {
  it("clears voice assignments from non-voice production cues", () => {
    const project = createProject();
    const line = { ...project.script.lines.find((item) => item.assignedVoiceRoleId)!, type: "sound-effect" as const };

    expect(voiceRoleIdForLine(line)).toBeUndefined();
  });

  it("repairs stale assignments while preserving valid manual voice choices", () => {
    const project = createProject();
    const customRole = {
      ...project.voiceRoles[0],
      id: "voice-custom-demo",
      roleName: "Custom demo voice",
    };
    const staleMusicLine = {
      ...project.script.lines[0],
      type: "music" as const,
      assignedVoiceRoleId: "voice-announcer",
    };
    const manualVoiceLine = {
      ...project.script.lines.find((line) => line.type === "announcer")!,
      assignedVoiceRoleId: customRole.id,
    };
    const legalLine = {
      ...project.script.lines.find((line) => line.type === "legal")!,
      assignedVoiceRoleId: customRole.id,
    };
    const repaired = assignVoiceRolesToScript(
      {
        ...project.script,
        lines: [staleMusicLine, manualVoiceLine, legalLine],
      },
      project.brief,
      [...project.voiceRoles, customRole],
      { preserveAssignedRoles: true },
    );

    expect(repaired.script.lines[0].assignedVoiceRoleId).toBeUndefined();
    expect(repaired.script.lines[1].assignedVoiceRoleId).toBe(customRole.id);
    expect(repaired.script.lines[2].assignedVoiceRoleId).toBe("voice-legal");
  });
});
