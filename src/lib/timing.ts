import type { ScriptLine } from "../types/models";

const WORD_DURATION_SECONDS = 0.34;
const FAST_READ_WORD_DURATION_SECONDS = 0.24;

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export const estimateLineDuration = (text: string, isLegal = false) => {
  const words = countWords(text);
  const base = words * (isLegal ? FAST_READ_WORD_DURATION_SECONDS : WORD_DURATION_SECONDS);
  const punctuationPauses = (text.match(/[.,:;!?]/g) ?? []).length * 0.12;
  return Math.max(0.4, Number((base + punctuationPauses).toFixed(1)));
};

export const assignLineTimings = (lines: ScriptLine[]) => {
  let cursor = 0;
  return lines.map((line) => {
    const startTime = Number((cursor + line.pauseBefore).toFixed(1));
    const endTime = Number((startTime + line.estimatedDuration).toFixed(1));
    cursor = endTime + line.pauseAfter;
    return { ...line, startTime, endTime };
  });
};

export const totalDuration = (lines: ScriptLine[]) =>
  Number((lines.reduce((max, line) => Math.max(max, line.endTime + line.pauseAfter), 0)).toFixed(1));

export const wordsPerSecond = (lines: ScriptLine[]) => {
  const voiceLines = lines.filter((line) => !["music", "sound-effect", "pause", "note"].includes(line.type));
  const words = voiceLines.reduce((sum, line) => sum + countWords(line.text), 0);
  const duration = totalDuration(lines);
  return duration ? Number((words / duration).toFixed(2)) : 0;
};

export const durationDiagnosis = (duration: number, target: number) => {
  if (duration > target + 2) return "Too many words for the selected duration.";
  if (duration < target - 5) return "There may be room for a stronger beat or sonic hook.";
  return "Timing is within working range.";
};
