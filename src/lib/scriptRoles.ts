import type { Brief, RadioScript, ScriptLine, ScriptLineType, VoiceRole } from "../types/models";

const spokenLineTypes = new Set<ScriptLineType>(["voiceover", "announcer", "character", "dialogue", "legal", "cta", "brand-mnemonic"]);

export const lineSupportsVoiceRole = (line: Pick<ScriptLine, "type">) => spokenLineTypes.has(line.type);

const normalizeSpeakerLabel = (value = "") =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const compactSpeakerLabel = (value = "") => normalizeSpeakerLabel(value).replace(/\s+/g, "");

const voiceoverNumberForSpeaker = (speaker?: string) => {
  const match = compactSpeakerLabel(speaker).match(/^(?:vo|voiceover)([123])$/);
  return match?.[1];
};

const isAnnouncerSpeaker = (speaker?: string) => /^(announcer|anncr)$/.test(normalizeSpeakerLabel(speaker));

const isBrandVoiceSpeaker = (speaker?: string) => {
  const normalized = normalizeSpeakerLabel(speaker);
  return ["brand", "brand voice", "brown", "brown voice", "mnemonic", "sonic logo"].includes(normalized);
};

const slugifyRoleId = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const titleCaseSpeaker = (value: string) =>
  normalizeSpeakerLabel(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const voiceRoleIdForLine = (line: Pick<ScriptLine, "type" | "speaker">) => {
  if (!lineSupportsVoiceRole(line)) return undefined;
  if (line.type === "legal") return "voice-legal";
  if (line.type === "brand-mnemonic" || isBrandVoiceSpeaker(line.speaker)) return "voice-brand";
  const voiceoverNumber = voiceoverNumberForSpeaker(line.speaker);
  if (voiceoverNumber) return `voice-voiceover-${voiceoverNumber}`;
  if (!line.speaker || isAnnouncerSpeaker(line.speaker)) return "voice-announcer";
  return `voice-${slugifyRoleId(line.speaker)}`;
};

const createVoiceRoleForLine = (line: Pick<ScriptLine, "type" | "speaker">, brief: Brief): VoiceRole => {
  const roleId = voiceRoleIdForLine(line) ?? "voice-announcer";
  if (roleId === "voice-brand") {
    return {
      id: roleId,
      roleName: "Brand / mnemonic voice",
      characterDescription: "Ownable brand voice for mnemonic, sonic logo, or short brand signature lines.",
      ageRange: "25-55",
      accent: brief.accentPreference || "neutral Irish",
      emotionalStyle: brief.brandVoiceNotes || "distinctive, warm, controlled",
      pace: "measured",
      performanceNotes: "Give the line room to feel branded without making it shouty.",
      pronunciationNotes: brief.mandatoryPhrases.join(", "),
      provider: "mock",
      rightsNotes: "Mock voice only. Clear the final brand voice or generated voice before broadcast.",
    };
  }

  const voiceoverNumber = voiceoverNumberForSpeaker(line.speaker);
  if (voiceoverNumber) {
    return {
      id: roleId,
      roleName: `Voiceover ${voiceoverNumber}`,
      characterDescription: "Scripted voiceover lane detected from the imported script.",
      ageRange: "25-55",
      accent: brief.accentPreference || "neutral Irish",
      emotionalStyle: brief.tone || "clear, human, controlled",
      pace: "conversational",
      performanceNotes: "Cast separately from the announcer if this VO has a distinct job in the ad.",
      pronunciationNotes: brief.mandatoryPhrases.join(", "),
      provider: "mock",
      rightsNotes: "Mock voice only. Map to a real provider voice before production.",
    };
  }

  return {
    id: roleId,
    roleName: titleCaseSpeaker(line.speaker ?? "Announcer"),
    characterDescription: "Character or named speaker detected from the imported script.",
    ageRange: "25-55",
    accent: brief.accentPreference || "neutral Irish",
    emotionalStyle: brief.tone || "natural, grounded",
    pace: "conversational",
    performanceNotes: "Keep the role distinct enough that the listener understands who is speaking.",
    pronunciationNotes: brief.mandatoryPhrases.join(", "),
    provider: "mock",
    rightsNotes: "Mock voice only. Confirm usage rights for final voice.",
  };
};

const shouldPreserveAssignedRole = (line: ScriptLine, roleMap: Map<string, VoiceRole>) =>
  Boolean(
    line.assignedVoiceRoleId &&
      roleMap.has(line.assignedVoiceRoleId) &&
      lineSupportsVoiceRole(line) &&
      line.type !== "legal",
  );

export const assignVoiceRolesToScript = (
  script: RadioScript,
  brief: Brief,
  existingRoles: VoiceRole[],
  options: { preserveAssignedRoles?: boolean } = {},
) => {
  const roleMap = new Map(existingRoles.map((role) => [role.id, role]));
  const lines = script.lines.map((line) => {
    const assignedVoiceRoleId =
      options.preserveAssignedRoles && shouldPreserveAssignedRole(line, roleMap)
        ? line.assignedVoiceRoleId
        : voiceRoleIdForLine(line);

    if (assignedVoiceRoleId && !roleMap.has(assignedVoiceRoleId)) {
      roleMap.set(assignedVoiceRoleId, createVoiceRoleForLine(line, brief));
    }
    return { ...line, assignedVoiceRoleId };
  });

  return {
    script: { ...script, lines },
    voiceRoles: Array.from(roleMap.values()),
  };
};
