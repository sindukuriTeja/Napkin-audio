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

export const defaultScript = `SFX: A kettle clicks off. A soft kitchen morning.
MOTHER: You know that tiny panic when the school lunch is still in the fridge?
CHILD: Again?
MOTHER: Exactly. Again.
ANNOUNCER: With Napkin Fresh, weekday mornings feel a little less impossible.
SFX: Lunchbox snaps shut.
ANNOUNCER: Pick it up today in store or visit napkinfresh.ie.
LEGAL: Subject to availability. See website for full terms and participating stores.
MNEMONIC: Napkin Fresh. Sorted before the bell.`;

export const defaultBrief = (): Brief => ({
  projectName: "Napkin Fresh Morning Save",
  client: "Napkin",
  brand: "Napkin Fresh",
  campaign: "Morning Save",
  productService: "Fresh lunchbox range",
  category: "Retail food",
  audience: "Busy parents on weekday mornings",
  tone: "Warm, lightly comic, useful",
  energyLevel: 6,
  desiredEmotionalResponse: "Relief with a smile",
  targetDuration: 30,
  mandatoryPhrases: ["Napkin Fresh"],
  legalLines: ["Subject to availability."],
  offer: "",
  cta: "Visit napkinfresh.ie",
  stationGroup: "irish-radio-generic",
  language: "English",
  accentPreference: "soft Irish",
  brandVoiceNotes: "Helpful, human, never shouty.",
  bannedPhrases: ["game changer"],
  competitorReferences: "",
  sonicLogoNotes: "A clean lunchbox snap can become the mnemonic.",
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
        title: "Leave room before the reveal",
        principle: "A tiny silence before a brand or joke payoff makes the listener lean in.",
        example: "Half beat, then brand line.",
        category: "timing",
        source: "Senior producer note",
        confidence: 0.82,
        usageNotes: "Use sparingly; dead air feels intentional only when the setup is clear.",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      {
        id: "memory-legal-dry",
        title: "Legal copy stays dry",
        principle: "Do not hide legal under music or a joke.",
        example: "Lower bed, clear read, no comic accent.",
        category: "legal",
        source: "Production discipline",
        confidence: 0.9,
        usageNotes: "Always verify final requirements with the station and client.",
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
  const sound = SoundDesignAgent.buildCues(project);
  const withSound = {
    ...project,
    soundCues: project.soundCues.length ? project.soundCues : sound.soundCues,
    musicCues: project.musicCues.length ? project.musicCues : sound.musicCues,
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
  const parsed = ScriptParserAgent.parse(rawScript, project.brief.targetDuration);
  const { script, voiceRoles } = assignVoiceRolesToScript(parsed, project.brief, project.voiceRoles);
  return recomputeProject({ ...project, script, voiceRoles, soundCues: [], musicCues: [] }, "Script parsed");
};
