import type { Project, QCResult } from "../types/models";

const lines = (items: string[]) => items.filter(Boolean).join("\n");

export const exportProjectJson = (project: Project) =>
  new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });

export const scriptMarkdown = (project: Project) =>
  lines([
    `# ${project.brief.projectName} Script`,
    "",
    `Client: ${project.brief.client}`,
    `Brand: ${project.brief.brand}`,
    `Target duration: ${project.brief.targetDuration}s`,
    `Estimated duration: ${project.script.estimatedDuration}s`,
    "",
    ...project.script.lines.map(
      (line) =>
        `**${line.lineNumber}. ${line.speaker ?? line.type}** [${line.startTime.toFixed(1)}-${line.endTime.toFixed(1)}s]\n${line.text}\n_Performance:_ ${line.performanceNote}`,
    ),
  ]);

export const cueSheetMarkdown = (project: Project) =>
  lines([
    `# ${project.brief.projectName} Cue Sheet`,
    "",
    "## Voice",
    ...project.script.lines.map(
      (line) =>
        `- ${line.startTime.toFixed(1)}-${line.endTime.toFixed(1)}s: ${line.speaker ?? line.type} — ${line.text}`,
    ),
    "",
    "## SFX",
    ...project.soundCues.map((cue) => `- ${cue.startTime.toFixed(1)}s: ${cue.label} — ${cue.notes}`),
    "",
    "## Music",
    ...project.musicCues.map((cue) => `- ${cue.startTime.toFixed(1)}-${cue.endTime.toFixed(1)}s: ${cue.style} — ${cue.notes}`),
  ]);

export const qcMarkdown = (project: Project, qcResults: QCResult[] = project.qcResults) =>
  lines([
    `# ${project.brief.projectName} QC Report`,
    "",
    "Napkin AI Audio Studio does not automatically label work broadcast-ready. Human approval is required.",
    "",
    ...qcResults.map(
      (result) =>
        `- **${result.status.toUpperCase()}** ${result.check}: ${result.explanation} Fix: ${result.recommendedFix} Confidence: ${result.confidence}`,
    ),
  ]);

export const craftQualityMarkdown = (project: Project) =>
  lines([
    `# ${project.brief.projectName} Craft Quality`,
    "",
    `Overall: ${project.craftQuality.overallScore}/100`,
    `Band: ${project.craftQuality.scoreBand}`,
    `Recommendation: ${project.craftQuality.recommendation}`,
    `Next move: ${project.craftQuality.nextBestCraftMove}`,
    "",
    "## Sub-scores",
    ...project.craftQuality.subScores.map(
      (score) => `- ${score.label}: ${score.score}/10 — ${score.explanation} Improve: ${score.improvement}`,
    ),
  ]);

export const productionNotesMarkdown = (project: Project) =>
  lines([
    `# ${project.brief.projectName} Production Notes`,
    "",
    `Tone: ${project.brief.tone}`,
    `Audience: ${project.brief.audience}`,
    `Emotional response: ${project.brief.desiredEmotionalResponse}`,
    `Approval status: ${project.approvalStatus}`,
    "",
    "## Voice roles",
    ...project.voiceRoles.map((role) => `- ${role.roleName}: ${role.accent}, ${role.emotionalStyle}. ${role.performanceNotes}`),
    "",
    "## Rights",
    ...project.rightsRecords.map(
      (record) => `- ${record.source}: ${record.licenceStatus}, owner ${record.owner || "unknown"}, confidence ${record.confidenceLevel}`,
    ),
  ]);

export const downloadText = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
