import {
  buildTimeline,
  ComplianceAgent,
  CraftQualityAgent,
  EmotionAgent,
  MixEngineerAgent,
  ScriptParserAgent,
  SoundDesignAgent,
  StationDeliveryAgent,
  TimingAgent,
  VoiceCastingAgent,
} from "../agents/studioAgents";
import { createId, nowIso } from "../lib/id";
import { assignVoiceRolesToScript } from "../lib/scriptRoles";
import type { Brief, CraftQualityScore, Project, RightsRecord } from "../types/models";
import { exportPresets, stationSpecs } from "./stationSpecs";

export const defaultScript = `SFX: Wind over open hills. Distant sheep. A soft sea swell far below.
MUSIC: Sparse piano. Very quiet.
VO1: No reception desk.
VO1: No room number.
VO1: No corridor carpet.
VO1: No little card telling you breakfast ends at ten.
SFX: Sliding van door opens. Kettle clicks. Rain taps softly on the roof.
VO2: Just Kerry outside the window.
VO2: A mountain behind you.
VO2: The Atlantic below.
VO2: And nowhere you need to be.
SFX: A blanket shakes out. Small laugh. Wind opens wider.
VO3: Volkswagen camper vans don't just take you through Ireland.
VO3: They let you stop in the middle of it.
MUSIC: Small lift.
ANNOUNCER: Volkswagen Camper Vans.
ANNOUNCER: Wake up here.
SFX: Sea, wind, kettle. Fade.`;

export const defaultBrief = (): Brief => ({
  projectName: "Wake Up Here",
  client: "Volkswagen Ireland",
  brand: "Volkswagen Camper Vans",
  campaign: "Wake Up Here",
  productService: "Volkswagen camper van range",
  category: "Automotive",
  audience: "Irish adults 30–55, outdoors-minded, weekend escape seekers",
  tone: "Quiet, cinematic, unhurried, poetic",
  energyLevel: 3,
  desiredEmotionalResponse: "Stillness, freedom, longing to be there",
  targetDuration: 38,
  mandatoryPhrases: ["Volkswagen Camper Vans"],
  legalLines: [],
  offer: "",
  cta: "Wake up here",
  stationGroup: "irish-radio-generic",
  language: "English",
  accentPreference: "Irish",
  brandVoiceNotes: "Warm, unhurried, intimate. Never shouty. Feels like a friend who already lives this way.",
  bannedPhrases: ["game changer", "revolutionary", "ultimate"],
  competitorReferences: "",
  sonicLogoNotes: "Sea, wind, kettle fade to silence is the brand mnemonic. Do not undercut it with music.",
});

const emptyCraftQuality: CraftQualityScore = {
  overallScore: 0,
  scoreBand: "Not run",
  subScores: [],
  strengths: [],
  improvements: [],
  lineNotes: [],
  nextBestCraftMove: "Run Craft Quality.",
  recommendation: "Rewrite",
};

const defaultRights = (): RightsRecord[] => [
  {
    id: "rights-mock-voice",
    source: "Mock voice provider",
    licenceStatus: "generated",
    owner: "Napkin Audio AI Studio mock system",
    usageTerritory: "Internal review only",
    usageChannel: "Internal review only",
    notes: "Mock records are not cleared production assets.",
    confidenceLevel: "verified",
  },
  {
    id: "rights-music-placeholder",
    source: "Main music bed placeholder",
    licenceStatus: "unknown",
    owner: "",
    usageTerritory: "Unknown",
    usageChannel: "Radio",
    notes: "Replace with licensed or owned music before production.",
    confidenceLevel: "unknown",
  },
];

export const createProject = (brief: Brief = defaultBrief(), rawScript = defaultScript): Project => {
  const script = ScriptParserAgent.parse(rawScript, brief.targetDuration);
  const { script: assignedScript, voiceRoles } = assignVoiceRolesToScript(script, brief, VoiceCastingAgent.defaultRoles());
  const base: Project = {
    id: createId("project"),
    brief,
    script: assignedScript,
    scriptLocked: false,
    voiceRoles,
    voiceTakes: [],
    soundCues: [],
    musicCues: [],
    timeline: [],
    mixSettings: {
      voiceLevel: -3,
      musicLevel: -16,
      sfxLevel: -10,
      compressionIntensity: 45,
      brightness: 48,
      warmth: 62,
      roomSpace: 22,
      deEssing: 38,
      noiseBed: 0,
      finalLimiter: true,
      loudnessTarget: "Confirm per station",
      truePeakTarget: "Confirm per station",
    },
    stationSpecId: stationSpecs[0].id,
    exportPresetId: exportPresets[0].id,
    qcResults: [],
    agentRecommendations: [],
    craftMemory: [
      {
        id: "memory-silence-payoff",
        title: "Leave room before the brand reveal",
        principle: "A tiny silence before the brand line makes the listener lean in.",
        example: "Half beat of sea and wind, then: Volkswagen Camper Vans.",
        category: "timing",
        source: "Senior producer note",
        confidence: 0.82,
        usageNotes: "The mnemonic only lands if the VO before it has fully resolved.",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      {
        id: "memory-vo-fragmented",
        title: "Short lines breathe",
        principle: "Fragmenting the VO into short lines lets the sound design fill the space between them.",
        example: "No room number. / No corridor carpet. — each line is its own beat.",
        category: "performance",
        source: "Production discipline",
        confidence: 0.88,
        usageNotes: "Direct the voice to find the end of each line before moving to the next.",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      {
        id: "memory-sfx-bed",
        title: "SFX is the world, music is the emotion",
        principle: "Keep SFX naturalistic and music minimal so neither fights the voice.",
        example: "Wind and sea under VO1 and VO2. Piano lift only at the brand moment.",
        category: "sound_design",
        source: "Mix discipline",
        confidence: 0.9,
        usageNotes: "If the SFX is doing its job the music barely needs to exist.",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ],
    commandLog: [],
    versionHistory: [],
    rightsRecords: defaultRights(),
    approvalStatus: "Draft",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    craftQuality: emptyCraftQuality,
  };
  return recomputeProject(base, "Initial project");
};

export const recomputeProject = (project: Project, summary = "Studio state refreshed", options: { trackVersion?: boolean } = {}): Project => {
  const trackVersion = options.trackVersion ?? true;
  const isResetStage = summary === "Initial project" || summary === "Script parsed";
  const sound = SoundDesignAgent.buildCues(project);
  const withSound = {
    ...project,
    soundCues: isResetStage && !project.soundCues.length ? sound.soundCues : project.soundCues,
    musicCues: isResetStage && !project.musicCues.length ? sound.musicCues : project.musicCues,
  };

  const agentRecommendations = [
    TimingAgent.recommendation(withSound),
    ...EmotionAgent.recommendations(withSound),
    ...sound.recommendations,
    MixEngineerAgent.recommendation(withSound),
    StationDeliveryAgent.recommendation(),
  ];
  const withTimeline = {
    ...withSound,
    timeline: buildTimeline(withSound),
    agentRecommendations,
    updatedAt: nowIso(),
  };
  const qcResults = ComplianceAgent.runQc(withTimeline);
  const withQc = { ...withTimeline, qcResults };
  const craftQuality = CraftQualityAgent.score(withQc);
  const versionEntry = {
    id: createId("version"),
    label: `Version ${project.versionHistory.length + 1}`,
    changeType: "state-refresh",
    summary,
    createdAt: nowIso(),
    preferred: project.versionHistory.length === 0,
    snapshot: {
      brief: withQc.brief,
      script: withQc.script,
      scriptLocked: withQc.scriptLocked,
      voiceRoles: withQc.voiceRoles,
      soundCues: withQc.soundCues,
      musicCues: withQc.musicCues,
      mixSettings: withQc.mixSettings,
      approvalStatus: withQc.approvalStatus,
    },
  };
  return {
    ...withQc,
    craftQuality,
    versionHistory: trackVersion ? [...project.versionHistory, versionEntry].slice(-12) : project.versionHistory,
  };
};

export const updateScriptFromText = (project: Project, rawScript: string) => {
  if (project.scriptLocked) return project;
  const previousLines = project.script.lines;
  const parsed = ScriptParserAgent.parse(rawScript, project.brief.targetDuration);
  const { script, voiceRoles } = assignVoiceRolesToScript(parsed, project.brief, project.voiceRoles);

  // Every parse regenerates fresh line ids, even for unchanged text, so a naive lineId lookup would
  // orphan every sound cue on every parse. Re-link cues to their matching new line by position + text
  // instead: content that's unchanged keeps its cue (and audioUrl); content that's genuinely gone
  // loses its cue; content that's genuinely new gets a freshly detected one below.
  const previousLineIdByPosition = new Map(previousLines.map((line) => [`${line.lineNumber}::${line.text}`, line.id]));
  const newLineIdByOldLineId = new Map<string, string>();
  script.lines.forEach((line) => {
    const oldId = previousLineIdByPosition.get(`${line.lineNumber}::${line.text}`);
    if (oldId) newLineIdByOldLineId.set(oldId, line.id);
  });
  const currentLineIds = new Set(script.lines.map((line) => line.id));

  const reconciledSoundCues = project.soundCues
    .map((cue) => (cue.lineId && newLineIdByOldLineId.has(cue.lineId) ? { ...cue, lineId: newLineIdByOldLineId.get(cue.lineId) } : cue))
    .filter((cue) => !cue.lineId || currentLineIds.has(cue.lineId));

  const coveredLineIds = new Set(reconciledSoundCues.map((cue) => cue.lineId).filter((id): id is string => Boolean(id)));
  const detected = SoundDesignAgent.buildCues({ ...project, script, soundCues: [], musicCues: [] });
  const newCuesForFreshLines = detected.soundCues.filter((cue) => cue.lineId && !coveredLineIds.has(cue.lineId));

  return recomputeProject(
    { ...project, script, voiceRoles, soundCues: [...reconciledSoundCues, ...newCuesForFreshLines] },
    "Script parsed",
  );
};
