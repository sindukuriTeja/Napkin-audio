export type ScriptLineType =
  | "voiceover"
  | "announcer"
  | "character"
  | "dialogue"
  | "sound-effect"
  | "music"
  | "pause"
  | "legal"
  | "cta"
  | "brand-mnemonic"
  | "note";

export type ApprovalStatus =
  | "Draft"
  | "Internal review"
  | "Client review"
  | "Approved for production"
  | "Approved for broadcast"
  | "Exported";

export type ConfidenceLevel = "verified" | "assumed" | "unknown";
export type LicenceStatus = "owned" | "licensed" | "generated" | "public domain" | "unknown" | "needs clearance";
export type RecommendationSeverity = "info" | "warn" | "critical";

export interface Brief {
  projectName: string;
  client: string;
  brand: string;
  campaign: string;
  productService: string;
  category: string;
  audience: string;
  tone: string;
  energyLevel: number;
  desiredEmotionalResponse: string;
  targetDuration: number;
  mandatoryPhrases: string[];
  legalLines: string[];
  offer: string;
  cta: string;
  stationGroup: string;
  language: string;
  accentPreference: string;
  brandVoiceNotes: string;
  bannedPhrases: string[];
  competitorReferences: string;
  sonicLogoNotes: string;
}

export interface RadioScript {
  id: string;
  title: string;
  rawText: string;
  lines: ScriptLine[];
  estimatedDuration: number;
  wordsPerSecond: number;
  targetDuration: number;
}

export interface ScriptLine {
  id: string;
  lineNumber: number;
  speaker?: string;
  text: string;
  type: ScriptLineType;
  assignedVoiceRoleId?: string;
  estimatedDuration: number;
  startTime: number;
  endTime: number;
  emotionalIntent: string[];
  performanceNote: string;
  accentNote: string;
  stressWords: string[];
  pauseBefore: number;
  pauseAfter: number;
  comedyFunction?: string;
  soundCueId?: string;
  warnings: string[];
}

export interface VoiceRole {
  id: string;
  roleName: string;
  characterDescription: string;
  genderPresentation?: string;
  ageRange: string;
  accent: string;
  emotionalStyle: string;
  pace: "slow" | "measured" | "conversational" | "quick" | "fast-read";
  performanceNotes: string;
  pronunciationNotes: string;
  provider: "mock" | "elevenlabs" | "nvidia-riva";
  providerVoiceId?: string;
  preferredTakeId?: string;
  rightsNotes: string;
}

export interface VoiceProviderConfig {
  provider: "mock" | "elevenlabs" | "nvidia-riva";
  apiKey?: string;
  endpoint?: string;
  defaultVoiceId?: string;
}

export interface VoiceTake {
  id: string;
  lineId?: string;
  roleId: string;
  takeNumber: number;
  provider: VoiceRole["provider"];
  settings: Record<string, string | number | boolean>;
  performanceNotes: string;
  audioUrl?: string;
  isMock: boolean;
  isPreferred: boolean;
  notes: string;
  createdAt: string;
}

export interface SoundCue {
  id: string;
  lineId?: string;
  label: string;
  location: string;
  texture: string;
  sfxMoment: string;
  foley: string;
  startTime: number;
  endTime: number;
  notes: string;
  rightsId?: string;
}

export interface MusicCue {
  id: string;
  label: string;
  style: string;
  tempo: string;
  instrumentation: string;
  mood: string;
  startTime: number;
  endTime: number;
  notes: string;
  rightsId?: string;
}

export interface TimelineBlock {
  id: string;
  start: number;
  end: number;
  type: ScriptLineType | "voice" | "sfx";
  label: string;
  notes: string;
  linkedScriptLineId?: string;
  warningStatus?: "ok" | "warn" | "fail";
}

export interface MixSettings {
  voiceLevel: number;
  musicLevel: number;
  sfxLevel: number;
  compressionIntensity: number;
  brightness: number;
  warmth: number;
  roomSpace: number;
  deEssing: number;
  noiseBed: number;
  finalLimiter: boolean;
  loudnessTarget: string;
  truePeakTarget: string;
}

export interface StationSpec {
  id: string;
  name: string;
  group: string;
  acceptedFormats: string[];
  sampleRate: string;
  bitDepth: string;
  channels: string;
  loudnessTarget: string;
  truePeakCeiling: string;
  maxDuration: number;
  namingConvention: string;
  deliveryEmail: string;
  deliveryPlatform: string;
  notes: string;
  lastVerified: string;
  sourceUrl: string;
  confidenceLevel: ConfidenceLevel;
}

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  formats: string[];
  metadataFields: string[];
  requiresQcPass: boolean;
  requiresHumanApproval: boolean;
  stationSpecIds: string[];
}

export interface QCResult {
  id: string;
  check: string;
  status: "pass" | "warn" | "fail";
  explanation: string;
  recommendedFix: string;
  confidence: ConfidenceLevel;
}

export interface AgentRecommendation {
  id: string;
  agentName: string;
  severity: RecommendationSeverity;
  confidence: number;
  affectedLineIds: string[];
  title: string;
  detail: string;
  suggestedAction: string;
}

export interface CraftMemoryItem {
  id: string;
  title: string;
  principle: string;
  example: string;
  category: string;
  source: string;
  confidence: number;
  usageNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CraftSubScore {
  label: string;
  score: number;
  explanation: string;
  improvement: string;
}

export interface CraftQualityScore {
  overallScore: number;
  scoreBand: string;
  subScores: CraftSubScore[];
  strengths: string[];
  improvements: string[];
  lineNotes: AgentRecommendation[];
  nextBestCraftMove: string;
  recommendation:
    | "Rewrite"
    | "Recast voice"
    | "Improve performance direction"
    | "Improve sound design"
    | "Tighten timing"
    | "Ready for producer review";
}

export interface CommandIntent {
  id: string;
  rawCommand: string;
  intent:
    | "tighten-script"
    | "change-voice"
    | "change-music"
    | "improve-ending"
    | "slow-legal"
    | "remove-sfx"
    | "export"
    | "alternate-endings"
    | "performance-note"
    | "unknown";
  proposedChange: string;
  affectedLineIds: string[];
  status: "proposed" | "applied" | "rejected";
  createdAt: string;
}

export interface VersionEntry {
  id: string;
  label: string;
  changeType: string;
  summary: string;
  createdAt: string;
  preferred: boolean;
  snapshot: Pick<Project, "brief" | "script" | "voiceRoles" | "soundCues" | "musicCues" | "mixSettings" | "approvalStatus">;
}

export interface RightsRecord {
  id: string;
  source: string;
  licenceStatus: LicenceStatus;
  owner: string;
  expiryDate?: string;
  usageTerritory: string;
  usageChannel: string;
  notes: string;
  confidenceLevel: ConfidenceLevel;
}

export interface Project {
  id: string;
  brief: Brief;
  script: RadioScript;
  voiceRoles: VoiceRole[];
  voiceTakes: VoiceTake[];
  soundCues: SoundCue[];
  musicCues: MusicCue[];
  timeline: TimelineBlock[];
  mixSettings: MixSettings;
  stationSpecId: string;
  exportPresetId: string;
  qcResults: QCResult[];
  agentRecommendations: AgentRecommendation[];
  craftMemory: CraftMemoryItem[];
  craftQuality: CraftQualityScore;
  commandLog: CommandIntent[];
  versionHistory: VersionEntry[];
  rightsRecords: RightsRecord[];
  approvalStatus: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
}
