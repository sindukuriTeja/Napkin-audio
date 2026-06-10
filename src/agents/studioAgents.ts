import { createId, nowIso } from "../lib/id";
import { assignLineTimings, countWords, durationDiagnosis, estimateLineDuration, totalDuration, wordsPerSecond } from "../lib/timing";
import type {
  AgentRecommendation,
  CommandIntent,
  CraftQualityScore,
  CraftSubScore,
  MusicCue,
  Project,
  QCResult,
  RadioScript,
  ScriptLine,
  ScriptLineType,
  SoundCue,
  TimelineBlock,
  VoiceRole,
} from "../types/models";

const legalTerms = ["terms", "conditions", "subject to", "apr", "representative", "eligibility", "over 18"];
const ctaTerms = ["call", "visit", "book", "download", "order", "search", "go to", "find us"];
const emotionLexicon: Record<string, string[]> = {
  warmth: ["home", "family", "care", "together", "soft", "welcome"],
  urgency: ["now", "today", "hurry", "limited", "last chance", "ends"],
  humour: ["really", "awkward", "of course", "sure", "brilliant", "what could"],
  sadness: ["miss", "lost", "quiet", "alone", "gone"],
  intimacy: ["listen", "between us", "secret", "close", "you know"],
  surprise: ["suddenly", "wait", "turns out", "actually", "plot twist"],
  tension: ["problem", "pressure", "risk", "stuck", "deadline"],
  sincerity: ["honest", "real", "promise", "clear", "matters"],
  confidence: ["proven", "trusted", "built", "ready", "guarantee"],
  fear: ["worry", "afraid", "danger", "risk", "panic"],
  excitement: ["new", "launch", "finally", "amazing", "big"],
  awkwardness: ["sorry", "um", "right", "silence", "awkward"],
  relief: ["sorted", "easy", "fixed", "relax", "done"],
  joy: ["smile", "bright", "happy", "laugh", "delight"],
  "deadpan energy": ["fine", "great", "obviously", "deadpan", "sure"],
};

const classifyLine = (raw: string): { speaker?: string; text: string; type: ScriptLineType } => {
  const trimmed = raw.trim();
  const speakerMatch = trimmed.match(/^([A-Z][A-Z0-9 _-]{1,28}):\s*(.+)$/);
  const speaker = speakerMatch?.[1]?.trim();
  const text = speakerMatch?.[2]?.trim() ?? trimmed;
  const label = speaker?.toLowerCase() ?? "";
  const lower = text.toLowerCase();
  if (/^\[?(sfx|fx|sound)/i.test(trimmed) || lower.includes("sfx:")) return { speaker, text, type: "sound-effect" };
  if (/^\[?(music|mx)/i.test(trimmed) || lower.includes("music:")) return { speaker, text, type: "music" };
  if (lower.includes("pause") || lower.includes("beat of silence")) return { speaker, text, type: "pause" };
  if (label.includes("mnemonic") || label.includes("sonic logo")) return { speaker, text, type: "brand-mnemonic" };
  if (legalTerms.some((term) => lower.includes(term))) return { speaker, text, type: "legal" };
  if (ctaTerms.some((term) => lower.includes(term))) return { speaker, text, type: "cta" };
  if (lower.includes("sonic logo") || lower.includes("mnemonic")) return { speaker, text, type: "brand-mnemonic" };
  if (speaker && /anncr|announcer|vo|voiceover/.test(speaker.toLowerCase())) return { speaker, text, type: "announcer" };
  if (speaker) return { speaker, text, type: "character" };
  return { text, type: "voiceover" };
};

const emotionsForText = (text: string) => {
  const lower = text.toLowerCase();
  return Object.entries(emotionLexicon)
    .filter(([, terms]) => terms.some((term) => lower.includes(term)))
    .map(([emotion]) => emotion);
};

const stressWordsForText = (text: string) =>
  text
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9']/g, ""))
    .filter((word) => word.length > 5 || /^[A-Z]{2,}$/.test(word))
    .slice(0, 4);

export const ScriptParserAgent = {
  parse(rawText: string, targetDuration: number): RadioScript {
    const source = rawText.trim() || "ANNOUNCER: Paste or upload a script to begin shaping the spot.";
    const parsed = source
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((raw, index): ScriptLine => {
        const classification = classifyLine(raw);
        const estimatedDuration = classification.type === "pause" ? 1 : estimateLineDuration(classification.text, classification.type === "legal");
        const emotions = emotionsForText(classification.text);
        return {
          id: createId("line"),
          lineNumber: index + 1,
          speaker: classification.speaker,
          text: classification.text,
          type: classification.type,
          estimatedDuration,
          startTime: 0,
          endTime: 0,
          emotionalIntent: emotions.length ? emotions : ["clear"],
          performanceNote: PerformanceDirectorAgent.noteForLine(classification.text, classification.type, emotions),
          accentNote: "",
          stressWords: stressWordsForText(classification.text),
          pauseBefore: classification.type === "brand-mnemonic" ? 0.4 : 0,
          pauseAfter: classification.type === "pause" ? 0.6 : classification.type === "cta" ? 0.2 : 0,
          comedyFunction: ComedyAgent.detectMechanism(classification.text),
          warnings: [],
        };
      });
    const timed = assignLineTimings(parsed);
    return {
      id: createId("script"),
      title: "Working radio script",
      rawText: source,
      lines: TimingAgent.withWarnings(timed, targetDuration),
      estimatedDuration: totalDuration(timed),
      wordsPerSecond: wordsPerSecond(timed),
      targetDuration,
    };
  },
};

export const TimingAgent = {
  withWarnings(lines: ScriptLine[], targetDuration: number) {
    const duration = totalDuration(lines);
    return lines.map((line) => {
      const warnings = [...line.warnings];
      if (line.type === "legal" && countWords(line.text) / Math.max(line.estimatedDuration, 1) > 3.4) {
        warnings.push("Legal line speed risk. Keep it clear and dry.");
      }
      if (line.endTime > targetDuration && !warnings.includes("Line falls beyond target duration.")) {
        warnings.push("Line falls beyond target duration.");
      }
      if (duration > targetDuration + 2 && line.lineNumber > lines.length - 3) {
        warnings.push("Final section is overcrowded.");
      }
      return { ...line, warnings };
    });
  },
  recommendation(project: Project): AgentRecommendation {
    return {
      id: createId("rec"),
      agentName: "TimingAgent",
      severity: project.script.estimatedDuration > project.brief.targetDuration + 2 ? "critical" : "info",
      confidence: 0.9,
      affectedLineIds: project.script.lines.filter((line) => line.endTime > project.brief.targetDuration).map((line) => line.id),
      title: durationDiagnosis(project.script.estimatedDuration, project.brief.targetDuration),
      detail: `Estimated ${project.script.estimatedDuration}s against a ${project.brief.targetDuration}s target at ${project.script.wordsPerSecond} words/sec.`,
      suggestedAction: "Tighten the final third, reduce legal clutter, or add silence if the spot is short.",
    };
  },
};

export const EmotionAgent = {
  recommendations(project: Project): AgentRecommendation[] {
    const emotionalLines = project.script.lines.filter((line) => line.emotionalIntent.length > 0);
    const hasShift = new Set(emotionalLines.flatMap((line) => line.emotionalIntent)).size > 2;
    return [
      {
        id: createId("rec"),
        agentName: "EmotionAgent",
        severity: hasShift ? "info" : "warn",
        confidence: 0.72,
        affectedLineIds: emotionalLines.map((line) => line.id),
        title: hasShift ? "Emotional movement is visible" : "Emotional arc feels flat",
        detail: hasShift
          ? "The script moves across more than two emotional states."
          : "The script could use a clearer turn, reveal, or moment of relief.",
        suggestedAction: "Mark one line as the emotional pivot and direct the voice around it.",
      },
    ];
  },
};

export const ComedyAgent = {
  detectMechanism(text: string) {
    const lower = text.toLowerCase();
    if (lower.includes("actually") || lower.includes("turns out")) return "reveal";
    if (lower.includes("but") || lower.includes("except")) return "undercut";
    if (lower.includes("again") || lower.includes("third")) return "rule of three";
    if (lower.includes("silence") || lower.includes("pause")) return "awkward silence";
    if (/[?!]$/.test(text.trim())) return "heightened reaction";
    return undefined;
  },
  recommendations(project: Project): AgentRecommendation[] {
    return project.script.lines
      .filter((line) => line.comedyFunction)
      .map((line) => ({
        id: createId("rec"),
        agentName: "ComedyAgent",
        severity: "info" as const,
        confidence: 0.66,
        affectedLineIds: [line.id],
        title: `Possible ${line.comedyFunction}`,
        detail: "This beat may work if the performance stays grounded and the reveal has room.",
        suggestedAction: "Leave half a beat before the payoff and avoid overperforming the joke.",
      }));
  },
};

export const PerformanceDirectorAgent = {
  noteForLine(text: string, type: ScriptLineType, emotions: string[]) {
    if (type === "legal") return "Keep the legal line clear, dry, and unhurried.";
    if (type === "cta") return "Smile through the CTA and land the action cleanly.";
    if (type === "brand-mnemonic") return "Give the brand line a tiny pocket of silence before it.";
    if (emotions.includes("humour") || ComedyAgent.detectMechanism(text)) return "Keep it real and dry. Do not overperform the joke.";
    if (emotions.includes("intimacy")) return "Say this like you are letting someone in on a secret.";
    if (emotions.includes("urgency")) return "Add forward motion without sounding shouty.";
    return "Conversational, specific, and human.";
  },
  recommendations(project: Project): AgentRecommendation[] {
    const missing = project.script.lines.filter((line) => !line.performanceNote && !["music", "sound-effect"].includes(line.type));
    return [
      {
        id: createId("rec"),
        agentName: "PerformanceDirectorAgent",
        severity: missing.length ? "warn" : "info",
        confidence: 0.8,
        affectedLineIds: missing.map((line) => line.id),
        title: missing.length ? "Some lines need performance direction" : "Performance notes are present",
        detail: missing.length
          ? "A voice session will be stronger with clear intent for each important line."
          : "The current script gives the voice talent usable direction.",
        suggestedAction: "Add notes for the reveal, CTA, and legal line.",
      },
    ];
  },
};

export const VoiceCastingAgent = {
  defaultRoles(): VoiceRole[] {
    return [
      {
        id: "voice-announcer",
        roleName: "Announcer",
        characterDescription: "Trusted, warm brand voice",
        ageRange: "30-50",
        accent: "neutral Irish",
        emotionalStyle: "warm, direct, clear",
        pace: "conversational",
        performanceNotes: "Confident without sounding corporate.",
        pronunciationNotes: "",
        provider: "mock",
        rightsNotes: "Mock voice only. Map a real provider voice before production.",
      },
      {
        id: "voice-legal",
        roleName: "Legal fast-read voice",
        characterDescription: "Clear legal read, not rushed",
        ageRange: "30-60",
        accent: "neutral Irish",
        emotionalStyle: "dry, precise",
        pace: "fast-read",
        performanceNotes: "Clarity over speed.",
        pronunciationNotes: "",
        provider: "mock",
        rightsNotes: "Mock voice only. Confirm usage rights for final voice.",
      },
    ];
  },
};

export const SoundDesignAgent = {
  buildCues(project: Project): { soundCues: SoundCue[]; musicCues: MusicCue[]; recommendations: AgentRecommendation[] } {
    const sfxLines = project.script.lines.filter((line) => line.type === "sound-effect" || line.text.toLowerCase().includes("sound"));
    const soundCues = sfxLines.map((line) => ({
      id: createId("sfx"),
      lineId: line.id,
      label: line.text.slice(0, 48),
      location: "Scripted moment",
      texture: "Natural, not cluttered",
      sfxMoment: line.text,
      foley: "Confirm in production",
      startTime: line.startTime,
      endTime: Math.max(line.endTime, line.startTime + 1),
      notes: "Check that this supports the voice rather than fighting it.",
    }));
    const musicCues: MusicCue[] = [
      {
        id: "music-bed-1",
        label: "Main music bed",
        style: project.brief.tone || "warm contemporary",
        tempo: project.brief.energyLevel > 6 ? "medium-up" : "measured",
        instrumentation: "Light pulse, restrained bed, optional final sting",
        mood: project.brief.desiredEmotionalResponse || "clear and memorable",
        startTime: 0,
        endTime: project.brief.targetDuration,
        notes: "Keep space around voice and legal copy.",
      },
    ];
    const recommendations: AgentRecommendation[] = [
      {
        id: createId("rec"),
        agentName: "SoundDesignAgent",
        severity: soundCues.length > 4 ? "warn" : "info",
        confidence: 0.78,
        affectedLineIds: sfxLines.map((line) => line.id),
        title: soundCues.length ? "Sound world has scripted cues" : "Add a stronger sonic hook",
        detail: soundCues.length
          ? "Use the cues selectively so the idea stays clear."
          : "The script would benefit from an opening sound or brand mnemonic.",
        suggestedAction: soundCues.length > 4 ? "Remove one or two SFX moments." : "Add a distinctive opening sound hook.",
      },
    ];
    return { soundCues, musicCues, recommendations };
  },
};

export const MixEngineerAgent = {
  recommendation(project: Project): AgentRecommendation {
    const musicTooLoud = project.mixSettings.musicLevel > project.mixSettings.voiceLevel - 8;
    return {
      id: createId("rec"),
      agentName: "MixEngineerAgent",
      severity: musicTooLoud ? "warn" : "info",
      confidence: 0.73,
      affectedLineIds: project.script.lines.filter((line) => ["legal", "cta"].includes(line.type)).map((line) => line.id),
      title: musicTooLoud ? "The sound bed may fight the voice" : "Voice has mix priority",
      detail: "Rough mix settings are planning notes only, not a mastered audio render.",
      suggestedAction: musicTooLoud ? "Lower music under legal and CTA sections." : "Confirm final loudness and true peak in production.",
    };
  },
};

export const buildTimeline = (project: Pick<Project, "script" | "musicCues" | "soundCues">): TimelineBlock[] => {
  const voiceBlocks: TimelineBlock[] = project.script.lines.map((line) => ({
    id: createId("block"),
    start: line.startTime,
    end: line.endTime,
    type: line.type,
    label: line.speaker ? `${line.speaker}: ${line.text.slice(0, 26)}` : line.text.slice(0, 32),
    notes: line.performanceNote,
    linkedScriptLineId: line.id,
    warningStatus: line.warnings.length ? "warn" : "ok",
  }));
  const sfxBlocks: TimelineBlock[] = project.soundCues.map((cue) => ({
    id: createId("block"),
    start: cue.startTime,
    end: cue.endTime,
    type: "sfx",
    label: cue.label,
    notes: cue.notes,
    linkedScriptLineId: cue.lineId,
    warningStatus: "ok",
  }));
  const musicBlocks: TimelineBlock[] = project.musicCues.map((cue) => ({
    id: createId("block"),
    start: cue.startTime,
    end: cue.endTime,
    type: "music",
    label: cue.label,
    notes: cue.notes,
    warningStatus: "ok",
  }));
  return [...musicBlocks, ...voiceBlocks, ...sfxBlocks].sort((a, b) => a.start - b.start);
};

const subScore = (label: string, score: number, explanation: string, improvement: string): CraftSubScore => ({
  label,
  score: Math.max(1, Math.min(10, Math.round(score))),
  explanation,
  improvement,
});

const scoreBand = (score: number) => {
  if (score < 40) return "Needs major craft work";
  if (score < 60) return "Functional but undercooked";
  if (score < 75) return "Good working draft";
  if (score < 85) return "Strong production potential";
  if (score < 95) return "Highly crafted";
  return "Exceptional, but still needs human approval";
};

export const CraftQualityAgent = {
  score(project: Project): CraftQualityScore {
    const hasBrand = project.script.rawText.toLowerCase().includes(project.brief.brand.toLowerCase()) || project.brief.brand.length < 2;
    const hasCta = project.script.lines.some((line) => line.type === "cta") || project.brief.cta.length > 2;
    const timingDelta = Math.abs(project.script.estimatedDuration - project.brief.targetDuration);
    const hasComedy = project.script.lines.some((line) => line.comedyFunction);
    const hasSonic = project.soundCues.length > 0 || project.brief.sonicLogoNotes.length > 2;
    const hasDirections = project.script.lines.filter((line) => line.performanceNote).length / Math.max(project.script.lines.length, 1);
    const subs = [
      subScore("Idea strength", hasBrand && hasCta ? 7 : 5, "The core advertising job is visible.", "Sharpen the single-minded idea."),
      subScore("Script clarity", project.script.wordsPerSecond < 3.2 ? 8 : 5, "The script can be followed at radio speed.", "Cut clauses that do not move the idea."),
      subScore("Emotional impact", new Set(project.script.lines.flatMap((line) => line.emotionalIntent)).size + 4, "Emotional cues are detectable.", "Give the listener a clearer turn."),
      subScore("Comedy / memorability", hasComedy ? 7 : 4, hasComedy ? "There are possible comic mechanics." : "Memorability needs a hook.", "Add a reveal, undercut, or sonic callback."),
      subScore("Character and performance potential", hasDirections ? 7 : 4, "Performance notes help the read feel directed.", "Add more line-specific direction."),
      subScore("Voice direction", project.voiceRoles.length > 1 ? 7 : 5, "Voice roles are mapped.", "Name the role, accent, pace, and rights status."),
      subScore("Sound design potential", hasSonic ? 7 : 4, "There is a sound-world route.", "Create an opening hook and final sting."),
      subScore("Timing discipline", timingDelta <= 2 ? 9 : timingDelta <= 5 ? 6 : 3, "Runtime is compared against the selected duration.", "Tighten to the booked duration."),
      subScore("Brand fit", hasBrand ? 8 : 4, hasBrand ? "Brand mention is present." : "Brand mention is weak or missing.", "Make the brand reveal clearer."),
      subScore("CTA / legal line handling", hasCta ? 7 : 4, "CTA/legal handling is checked.", "Keep legal clear and avoid final-five-second clutter."),
      subScore("Production readiness", project.qcResults.some((result) => result.status === "fail") ? 4 : 7, "QC status informs export readiness.", "Resolve fail-level QC before production handoff."),
    ];
    const overallScore = Math.round((subs.reduce((sum, item) => sum + item.score, 0) / (subs.length * 10)) * 100);
    const improvements = subs
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((item) => item.improvement);
    const recommendation =
      timingDelta > 2
        ? "Tighten timing"
        : !hasSonic
          ? "Improve sound design"
          : hasDirections < 0.7
            ? "Improve performance direction"
            : overallScore >= 75
              ? "Ready for producer review"
              : "Rewrite";
    return {
      overallScore,
      scoreBand: scoreBand(overallScore),
      subScores: subs,
      strengths: [
        hasBrand ? "Brand presence is clear" : "The campaign frame is ready to sharpen",
        hasCta ? "There is an action for the listener" : "CTA can become a stronger final move",
        timingDelta <= 2 ? "Timing is disciplined" : "The timing problem is visible and fixable",
      ],
      improvements,
      lineNotes: [
        ...ComedyAgent.recommendations(project),
        ...PerformanceDirectorAgent.recommendations(project),
      ].slice(0, 5),
      nextBestCraftMove: improvements[0] ?? "Run one more focused craft pass.",
      recommendation,
    };
  },
};

export const ComplianceAgent = {
  runQc(project: Project): QCResult[] {
    const missingMandatory = project.brief.mandatoryPhrases.filter(
      (phrase) => phrase.trim() && !project.script.rawText.toLowerCase().includes(phrase.toLowerCase()),
    );
    const stationUnknown = true;
    const voiceMissing = project.script.lines.filter(
      (line) => !["music", "sound-effect", "pause", "note"].includes(line.type) && !line.assignedVoiceRoleId,
    );
    const unknownRights = project.rightsRecords.filter((record) => ["unknown", "needs clearance"].includes(record.licenceStatus));
    const results: QCResult[] = [
      {
        id: createId("qc"),
        check: "Duration exactness",
        status: Math.abs(project.script.estimatedDuration - project.brief.targetDuration) <= 2 ? "pass" : "warn",
        explanation: `Estimated ${project.script.estimatedDuration}s for a ${project.brief.targetDuration}s target.`,
        recommendedFix: "Tighten or open the edit until producer timing is exact.",
        confidence: "assumed",
      },
      {
        id: createId("qc"),
        check: "Mandatory lines",
        status: missingMandatory.length ? "fail" : "pass",
        explanation: missingMandatory.length ? `Missing: ${missingMandatory.join(", ")}` : "Mandatory phrases appear in the script.",
        recommendedFix: "Add all mandatory phrases before export.",
        confidence: "assumed",
      },
      {
        id: createId("qc"),
        check: "CTA",
        status: project.script.lines.some((line) => line.type === "cta") || project.brief.cta ? "pass" : "fail",
        explanation: "CTA is checked against script tags and brief field.",
        recommendedFix: "Add a clear listener action.",
        confidence: "assumed",
      },
      {
        id: createId("qc"),
        check: "Legal line speed",
        status: project.script.lines.some((line) => line.type === "legal" && line.warnings.length) ? "warn" : "pass",
        explanation: "Legal reads are estimated locally and need producer confirmation.",
        recommendedFix: "Give legal copy room and dry delivery.",
        confidence: "assumed",
      },
      {
        id: createId("qc"),
        check: "Voice assignments",
        status: voiceMissing.length ? "warn" : "pass",
        explanation: voiceMissing.length ? `${voiceMissing.length} voice lines are not assigned.` : "Voice lines have assigned roles.",
        recommendedFix: "Assign voice roles before take generation.",
        confidence: "assumed",
      },
      {
        id: createId("qc"),
        check: "Rights records",
        status: unknownRights.length ? "warn" : "pass",
        explanation: unknownRights.length ? "Some voice, music, or SFX rights are unknown." : "No unknown rights records are present.",
        recommendedFix: "Clear usage rights before production or broadcast approval.",
        confidence: "unknown",
      },
      {
        id: createId("qc"),
        check: "Station spec",
        status: stationUnknown ? "warn" : "pass",
        explanation: "Station-specific technical requirements are marked unverified in this MVP.",
        recommendedFix: "Confirm sample rate, loudness, true peak, naming, and delivery route with station traffic.",
        confidence: "unknown",
      },
      {
        id: createId("qc"),
        check: "Human approval",
        status: project.approvalStatus === "Approved for broadcast" ? "pass" : "fail",
        explanation: "RA Studio never marks work broadcast-ready automatically.",
        recommendedFix: "A user must explicitly approve for broadcast after QC and production review.",
        confidence: "verified",
      },
    ];
    return results;
  },
};

export const StationDeliveryAgent = {
  recommendation(): AgentRecommendation {
    return {
      id: createId("rec"),
      agentName: "StationDeliveryAgent",
      severity: "warn",
      confidence: 0.6,
      affectedLineIds: [],
      title: "Station delivery specs need confirmation",
      detail: "Irish station rows are placeholders until verified against current traffic requirements.",
      suggestedAction: "Confirm file format, loudness, true peak, naming, and delivery platform before dispatch.",
    };
  },
};

export const ScriptDoctorAgent = {
  actions(project: Project) {
    const actions = ["Tighten script to selected duration", "Make ending more memorable", "Clarify CTA"];
    if (!project.soundCues.length) actions.push("Add stronger sound hook");
    if (project.script.lines.some((line) => line.type === "legal")) actions.push("Make legal line clearer");
    if (project.script.lines.some((line) => line.comedyFunction)) actions.push("Add silence before payoff");
    return actions;
  },
};

export const parseCommand = (rawCommand: string, project: Project): CommandIntent => {
  const lower = rawCommand.toLowerCase();
  const matchingLines = project.script.lines
    .filter((line) => lower.includes("legal") ? line.type === "legal" : lower.includes("end") ? line.lineNumber > project.script.lines.length - 3 : false)
    .map((line) => line.id);
  let intent: CommandIntent["intent"] = "unknown";
  if (lower.includes("tighten") || lower.includes("30 seconds")) intent = "tighten-script";
  else if (lower.includes("accent") || lower.includes("voice")) intent = "change-voice";
  else if (lower.includes("music")) intent = "change-music";
  else if (lower.includes("ending") || lower.includes("end line")) intent = "improve-ending";
  else if (lower.includes("legal") && lower.includes("slow")) intent = "slow-legal";
  else if (lower.includes("remove") && lower.includes("sound")) intent = "remove-sfx";
  else if (lower.includes("export")) intent = "export";
  else if (lower.includes("alternative")) intent = "alternate-endings";
  else if (lower.includes("warmer") || lower.includes("deadpan") || lower.includes("emotion")) intent = "performance-note";
  return {
    id: createId("cmd"),
    rawCommand,
    intent,
    proposedChange:
      intent === "unknown"
        ? "Could not confidently parse this. Add it as a producer note or rewrite the command."
        : "Proposed as a reversible craft action. Review before applying.",
    affectedLineIds: matchingLines,
    status: "proposed",
    createdAt: nowIso(),
  };
};

export const BriefAgent = { name: "BriefAgent" };
export const ExportAgent = { name: "ExportAgent" };
export const LearningFlywheelAgent = { name: "LearningFlywheelAgent" };
