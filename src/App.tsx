import { Mp3Encoder } from "@breezystack/lamejs";
import {
  CheckCircle2,
  ClipboardList,
  Download,
  FileAudio,
  LayoutDashboard,
  Lock,
  Mic,
  Gauge,
  Moon,
  Music2,
  PackageCheck,
  Pause,
  Pencil,
  Timer,
  Play,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Unlock,
  Upload,
  Wand2,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MixEngineerAgent,
  parseCommand,
  ScriptDoctorAgent,
  SoundDesignAgent,
  StudioKnowledgeAgent,
  VoiceCastingAgent,
} from "./agents/studioAgents";
import { createProject, recomputeProject, updateScriptFromText } from "./data/sampleProject";
import {
  craftQualityMarkdown,
  cueSheetMarkdown,
  downloadBlob,
  downloadText,
  exportProjectJson,
  productionNotesMarkdown,
  qcMarkdown,
  scriptMarkdown,
} from "./export/exportPackage";
import { createId } from "./lib/id";
import { assignVoiceRolesToScript, lineSupportsVoiceRole, voiceRoleIdForLine } from "./lib/scriptRoles";
import { assignLineTimings, estimateLineDuration, totalDuration, wordsPerSecond } from "./lib/timing";
import {
  fetchElevenLabsVoices,
  fetchProviderStatus,
  generateLlmProductionPlan,
  generateElevenLabsSpeechPreview,
  generateElevenLabsFullSpot,
  generateElevenLabsSoundEffect,
  generateElevenLabsMusic,
  providerProxyBaseUrl,
  type LlmProductionPlan,
  type FullSpotLine,
  type ProviderStatus,
  type ProviderVoice,
  type ElevenLabsSoundEffectModel,
  type ElevenLabsMusicModel,
} from "./services/providerProxy";
import { generateMockVoicePreviewBlob, MockVoiceProvider } from "./services/voiceProviders";
import type { Brief, Project, ScriptLineType, VoiceRole, VoiceTake, SoundCue, MusicCue } from "./types/models";

const productName = "Napkin Audio AI Studio";
const tabs = ["Studio", "Script", "Voices", "Sound Design", "Mix", "Compliance", "Export", "Brief", "Memory"] as const;
type Tab = (typeof tabs)[number];

const tabIcons: Record<Tab, React.ReactNode> = {
  Studio: <LayoutDashboard size={16} />,
  Script: <FileAudio size={16} />,
  Voices: <Mic size={16} />,
  "Sound Design": <Music2 size={16} />,
  Mix: <SlidersHorizontal size={16} />,
  Compliance: <ShieldCheck size={16} />,
  Export: <PackageCheck size={16} />,
  Brief: <ClipboardList size={16} />,
  Memory: <Sparkles size={16} />,
};

const tabDescriptions: Record<Tab, string> = {
  Studio: "The whole production at a glance — timing, timeline, and what to do next.",
  Script: "Write or paste the script, then parse it into timed, role-assigned lines.",
  Voices: "Cast a distinct voice per character and generate voice takes.",
  "Sound Design": "Design SFX cues, music beds, and the sonic logo.",
  Mix: "Balance voice, music, and SFX levels, then render the full mix.",
  Compliance: "Automated QC checks — a human still needs to sign off before broadcast.",
  Export: "Download the script, cue sheet, and project files.",
  Brief: "Shape the job before the script tries to solve it — client, audience, tone, duration.",
  Memory: "Studio knowledge, craft memory, and the command history.",
};

const productionTabs: Tab[] = ["Studio", "Script", "Voices", "Sound Design", "Mix"];
const sidebarSections: Array<{ heading: string; items: Tab[] }> = [
  { heading: "Project", items: ["Studio", "Brief"] },
  { heading: "Production", items: ["Script", "Voices", "Sound Design", "Mix"] },
  { heading: "Delivery", items: ["Compliance", "Export", "Memory"] },
];

const scriptLineTypes: ScriptLineType[] = [
  "voiceover",
  "announcer",
  "character",
  "dialogue",
  "sound-effect",
  "music",
  "pause",
  "legal",
  "cta",
  "brand-mnemonic",
  "note",
];

const durations = [10, 15, 20, 30, 40, 50, 60, 120];
const accentOptions = [
  "Irish",
  "Dublin",
  "Cork",
  "Galway / West",
  "Northern Irish",
  "neutral Irish",
  "rural Irish",
  "premium Irish",
  "working-class Dublin",
  "soft Irish",
  "RP",
  "London",
  "Manchester",
  "Scottish",
  "Welsh",
  "custom",
];

const setBriefField = <K extends keyof Brief>(project: Project, key: K, value: Brief[K]) =>
  recomputeProject({ ...project, brief: { ...project.brief, [key]: value } }, `Brief updated: ${String(key)}`);

const retimeScript = (script: Project["script"]) => {
  const numberedLines = script.lines.map((line, index) => ({ ...line, lineNumber: index + 1 }));
  const lines = assignLineTimings(numberedLines);
  return {
    ...script,
    lines,
    estimatedDuration: totalDuration(lines),
    wordsPerSecond: wordsPerSecond(lines),
  };
};

const rawTextFromLines = (lines: Project["script"]["lines"]) =>
  lines.map((line) => (line.speaker ? `${line.speaker}: ${line.text}` : line.text)).join("\n");

const formatTimecode = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
};

const storageKey = "napkin-audio-ai-studio-current-project";
const legacyStorageKeys = ["napkin-ai-audio-studio-current-project", "ra-studio-current-project"];

type ThemeMode = "dark" | "light";
const themeStorageKey = "napkin-audio-ai-studio-theme";

const loadInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(themeStorageKey);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

const isProjectLike = (value: unknown): value is Project =>
  Boolean(
    value &&
      typeof value === "object" &&
      "brief" in value &&
      "script" in value &&
      "voiceRoles" in value &&
      "mixSettings" in value,
  );

const normalizeProject = (candidate: Project) => {
  const fallback = createProject();
  const normalized = {
    ...fallback,
    ...candidate,
    brief: { ...fallback.brief, ...candidate.brief },
    script: { ...fallback.script, ...candidate.script, lines: candidate.script?.lines ?? fallback.script.lines },
    scriptLocked: candidate.scriptLocked ?? fallback.scriptLocked,
    voiceRoles: candidate.voiceRoles ?? fallback.voiceRoles,
    voiceTakes: (candidate.voiceTakes ?? fallback.voiceTakes).map((take) =>
      take.audioUrl?.startsWith("blob:") ? { ...take, audioUrl: undefined, notes: `${take.notes} Preview audio expired after browser reload.` } : take,
    ),
    soundCues: candidate.soundCues ?? fallback.soundCues,
    musicCues: candidate.musicCues ?? fallback.musicCues,
    timeline: candidate.timeline ?? fallback.timeline,
    mixSettings: { ...fallback.mixSettings, ...candidate.mixSettings },
    qcResults: candidate.qcResults ?? fallback.qcResults,
    agentRecommendations: candidate.agentRecommendations ?? fallback.agentRecommendations,
    craftMemory: candidate.craftMemory ?? fallback.craftMemory,
    craftQuality: candidate.craftQuality ?? fallback.craftQuality,
    commandLog: candidate.commandLog ?? fallback.commandLog,
    versionHistory: candidate.versionHistory ?? fallback.versionHistory,
    rightsRecords: candidate.rightsRecords ?? fallback.rightsRecords,
  };
  const repairedVoiceState = assignVoiceRolesToScript(normalized.script, normalized.brief, normalized.voiceRoles, {
    preserveAssignedRoles: true,
  });
  return { ...normalized, ...repairedVoiceState };
};

const loadInitialProject = () => {
  if (typeof window === "undefined") return createProject();
  const saved = window.localStorage.getItem(storageKey) ?? legacyStorageKeys.map((key) => window.localStorage.getItem(key)).find(Boolean);
  if (!saved) return createProject();
  try {
    const parsed = JSON.parse(saved);
    if (isProjectLike(parsed)) return recomputeProject(normalizeProject(parsed), "Loaded saved browser project", { trackVersion: false });
  } catch {
    window.localStorage.removeItem(storageKey);
  }
  return createProject();
};

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = raw PCM
  const bitDepth = 16;
  
  let result;
  if (numOfChan === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }
  
  const bufferLength = result.length * 2;
  const headerLength = 44;
  const arrayBuffer = new ArrayBuffer(headerLength + bufferLength);
  const view = new DataView(arrayBuffer);
  
  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + bufferLength, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, bufferLength, true);
  
  // Write PCM audio samples
  floatTo16BitPCM(view, 44, result);
  
  return new Blob([view], { type: 'audio/wav' });
}

function floatChannelToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function audioBufferToMp3(buffer: AudioBuffer, kbps = 192): Blob {
  const numOfChan = buffer.numberOfChannels >= 2 ? 2 : 1;
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(numOfChan, sampleRate, kbps);

  const left = floatChannelToInt16(buffer.getChannelData(0));
  const right = numOfChan === 2 ? floatChannelToInt16(buffer.getChannelData(1)) : undefined;

  const chunks: Uint8Array[] = [];
  const sampleBlockSize = 1152; // MP3 frame size lamejs expects per encode call
  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    const rightChunk = right ? right.subarray(i, i + sampleBlockSize) : undefined;
    const encoded = encoder.encodeBuffer(leftChunk, rightChunk);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) chunks.push(finalChunk);

  // lamejs' Uint8Array chunks are typed against ArrayBufferLike, which newer DOM lib
  // typings no longer accept directly as BlobPart; copy into plain ArrayBuffer-backed
  // views so Blob's constructor type-checks cleanly.
  const blobParts = chunks.map((chunk) => new Uint8Array(chunk));
  return new Blob(blobParts, { type: "audio/mp3" });
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

let activeAudioContext: AudioContext | null = null;
let activeSourceNode: AudioBufferSourceNode | null = null;

export function App() {
  const [project, setProject] = useState<Project>(() => loadInitialProject());
  const [theme, setTheme] = useState<ThemeMode>(() => loadInitialTheme());
  const [activeTab, setActiveTab] = useState<Tab>("Studio");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [mode, setMode] = useState<"creative" | "producer">("creative");
  const [ttsModel, setTtsModel] = useState<"eleven_multilingual_v2" | "eleven_v3">("eleven_multilingual_v2");
  // ElevenLabs ships one Sound Effects model today (eleven_text_to_sound_v2). Kept as state,
  // rather than a hardcoded literal, so a future v3 release only needs a new segmented option below.
  const [sfxModel, setSfxModel] = useState<ElevenLabsSoundEffectModel>("eleven_text_to_sound_v2");
  const [musicModel, setMusicModel] = useState<ElevenLabsMusicModel>("music_v1");
  const [scriptDraft, setScriptDraft] = useState(project.script.rawText);
  const [llmInput, setLlmInput] = useState("");
  const [llmPlanMessage, setLlmPlanMessage] = useState("Describe the ad, product, audience, offer, tone, and duration. Claude will create the script, voice plan, and sound plan.");
  const [isLlmPlanning, setIsLlmPlanning] = useState(false);
  const [commandDraft, setCommandDraft] = useState("");
  const [latestProposal, setLatestProposal] = useState<Project["commandLog"][number] | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceCommandStatus, setVoiceCommandStatus] = useState("Audio Director ready. Speak a production decision or type one below.");
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState("");
  const [voiceSourceFile, setVoiceSourceFile] = useState<File | null>(null);
  const [voiceTransformConsent, setVoiceTransformConsent] = useState(false);
  const [voiceTransformTargetRoleId, setVoiceTransformTargetRoleId] = useState(project.voiceRoles[0]?.id ?? "");
  const [voiceTransformMessage, setVoiceTransformMessage] = useState("Upload an approved VO recording to transform it into a directed target voice.");
  const [voiceTransformAudioUrl, setVoiceTransformAudioUrl] = useState("");
  const [voiceTakeMessage, setVoiceTakeMessage] = useState("Generate a take from the first assigned script line. ElevenLabs is used when the proxy and key are ready.");
  const [isGeneratingVoiceTake, setIsGeneratingVoiceTake] = useState(false);
  const [isGeneratingFullSpot, setIsGeneratingFullSpot] = useState(false);
  const [fullSpotMessage, setFullSpotMessage] = useState("Generate all spoken lines in order as one complete MP3.");
  const [transportTime, setTransportTime] = useState(0);
  const [isTransportPlaying, setIsTransportPlaying] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [providerStatusMessage, setProviderStatusMessage] = useState("Provider proxy not checked yet.");
  const [providerVoices, setProviderVoices] = useState<ProviderVoice[]>([]);
  const [providerVoicesMessage, setProviderVoicesMessage] = useState("Load the provider voice catalog to map roles quickly.");
  const [isLoadingProviderVoices, setIsLoadingProviderVoices] = useState(false);
  const [generatingSfxCueId, setGeneratingSfxCueId] = useState<string | null>(null);
  const [generatingMusicCueId, setGeneratingMusicCueId] = useState<string | null>(null);
  const [soundDesignMessage, setSoundDesignMessage] = useState("");
  const [playingVoiceTakeId, setPlayingVoiceTakeId] = useState<string | null>(null);
  const [mixedAudioUrl, setMixedAudioUrl] = useState<string | null>(null);
  const [isRenderingMix, setIsRenderingMix] = useState(false);
  const [mixRenderingMessage, setMixRenderingMessage] = useState("");
  const [isGeneratingAllAndMixing, setIsGeneratingAllAndMixing] = useState(false);
  const [generateAllAndMixMessage, setGenerateAllAndMixMessage] = useState("");

  const craftActions = useMemo(() => ScriptDoctorAgent.actions(project), [project]);
  const knowledgeHits = useMemo(() => StudioKnowledgeAgent.retrieve(project), [project]);
  const audioQualityHits = useMemo(() => StudioKnowledgeAgent.audioQualityGuidance(project), [project]);
  const voiceSearchBriefs = useMemo(() => VoiceCastingAgent.elevenLabsSearchBriefs(project), [project]);
  const productionPrompts = useMemo(() => SoundDesignAgent.productionPrompts(project), [project]);
  const transportDuration = Math.max(project.brief.targetDuration, project.script.estimatedDuration, 1);
  const activeTransportLine =
    project.script.lines.find((line) => transportTime >= line.startTime && transportTime <= line.endTime) ??
    project.script.lines.find((line) => line.startTime >= transportTime) ??
    project.script.lines[project.script.lines.length - 1];

  useEffect(() => {
    setScriptDraft(project.script.rawText);
  }, [project.script.rawText]);

  useEffect(() => {
    setTransportTime((current) => Math.min(current, transportDuration));
  }, [transportDuration]);

  useEffect(() => {
    if (!isTransportPlaying) return;
    const startedAt = performance.now();
    const originTime = transportTime;
    const timer = window.setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      const nextTime = Math.min(transportDuration, originTime + elapsedSeconds);
      setTransportTime(nextTime);
      if (nextTime >= transportDuration) setIsTransportPlaying(false);
    }, 80);
    return () => window.clearInterval(timer);
  }, [isTransportPlaying, transportDuration, transportTime]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(project));
    } catch {
      // Local persistence is a convenience only; export JSON remains the durable backup.
    }
  }, [project]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Theme persistence is a convenience only; it just falls back to the OS preference next load.
    }
  }, [theme]);

  const toggleTheme = () => setTheme((current) => (current === "dark" ? "light" : "dark"));

  const scriptTextFromLlmPlan = (plan: LlmProductionPlan) =>
    plan.scriptLines
      .map((line) => {
        const speaker = line.speaker || (line.type === "sound-effect" ? "SFX" : line.type === "music" ? "MUSIC" : "ANNOUNCER");
        return `${speaker}: ${line.text}`;
      })
      .join("\n");

  const applyLlmPlanToProject = (baseProject: Project, plan: LlmProductionPlan) => {
    const scriptText = scriptTextFromLlmPlan(plan);
    const parsedProject = updateScriptFromText({ ...baseProject, scriptLocked: false }, scriptText);
    const voiceRoles: VoiceRole[] = plan.voiceRoles.length
      ? plan.voiceRoles.map((role, index) => ({
          id: createId("voice"),
          roleName: role.roleName || `Voice ${index + 1}`,
          characterDescription: role.characterDescription || "AI selected radio voice",
          ageRange: role.ageRange || "Adult",
          accent: role.accent || parsedProject.brief.accentPreference || "Irish",
          emotionalStyle: role.emotionalStyle || parsedProject.brief.tone || "clear",
          pace: role.pace || "conversational",
          performanceNotes: role.performanceNotes || "Natural, clear, and specific.",
          pronunciationNotes: role.pronunciationNotes || "",
          provider: "elevenlabs",
          providerVoiceId: "XB0fDUnXU5powFXDhCwa",
          rightsNotes: role.elevenLabsSearchQuery ? `Claude casting query: ${role.elevenLabsSearchQuery}` : "ElevenLabs Irish voice assigned by default.",
        }))
      : parsedProject.voiceRoles;

    const roleByName = new Map(voiceRoles.map((role) => [role.roleName.toLowerCase(), role.id]));
    const firstSpokenRole = voiceRoles[0]?.id;
    const legalRole = voiceRoles.find((role) => role.pace === "fast-read" || role.roleName.toLowerCase().includes("legal"))?.id ?? firstSpokenRole;
    const scriptLines = parsedProject.script.lines.map((line, index) => {
      const planLine = plan.scriptLines[index];
      const explicitRole = planLine?.assignedVoiceRoleName ? roleByName.get(planLine.assignedVoiceRoleName.toLowerCase()) : undefined;
      const speakerRole = line.speaker ? roleByName.get(line.speaker.toLowerCase()) : undefined;
      const assignedVoiceRoleId = lineSupportsVoiceRole(line) ? explicitRole ?? speakerRole ?? (line.type === "legal" ? legalRole : firstSpokenRole) : undefined;
      return { ...line, assignedVoiceRoleId, performanceNote: planLine?.performanceNote || line.performanceNote };
    });

    const soundCues: SoundCue[] = plan.soundCues.map((cue) => {
      const linkedLine = cue.lineNumber ? scriptLines[cue.lineNumber - 1] : undefined;
      const startTime = Number(cue.startTime ?? linkedLine?.startTime ?? 0);
      const endTime = Number(cue.endTime ?? Math.max(startTime + 1.5, linkedLine?.endTime ?? startTime + 2));
      return { id: createId("sfx"), lineId: linkedLine?.id, label: cue.label || "AI sound cue", location: cue.location || "Claude production plan", texture: cue.texture || "Supportive and uncluttered", sfxMoment: cue.sfxMoment || cue.label || "subtle radio sound effect", foley: cue.foley || "Generated by ElevenLabs", startTime, endTime: Math.max(endTime, startTime + 0.5), notes: cue.notes || "AI-designed SFX prompt for ElevenLabs." };
    });

    const musicCues: MusicCue[] = plan.musicCues.map((cue) => {
      const startTime = Number(cue.startTime ?? 0);
      const endTime = Number(cue.endTime ?? parsedProject.brief.targetDuration);
      const musicPrompt = cue.elevenLabsMusicPrompt || `${cue.style || "radio bed"}, ${cue.mood || "clear"}, ${cue.instrumentation || "minimal production music"}, tempo: ${cue.tempo || "medium"}`;
      return { id: createId("music"), label: cue.label || "AI music bed", style: cue.style || "radio bed", tempo: cue.tempo || "medium", instrumentation: cue.instrumentation || "minimal production music", mood: cue.mood || parsedProject.brief.tone || "clear", startTime, endTime: Math.max(endTime, startTime + 3), notes: musicPrompt };
    });

    return recomputeProject({ ...parsedProject, brief: { ...parsedProject.brief, projectName: plan.title || parsedProject.brief.projectName }, script: { ...parsedProject.script, title: plan.title || parsedProject.script.title, lines: scriptLines }, voiceRoles, soundCues, musicCues }, "Claude generated script, voice plan, and sound plan");
  };

  const generateScriptVoiceAndSoundWithLlm = async (autoGenerate = false) => {
    const input = llmInput.trim();
    if (!input) {
      setLlmPlanMessage("Add a campaign input first: product, audience, offer, tone, duration, and any must-say lines.");
      return;
    }
    setIsLlmPlanning(true);
    setLlmPlanMessage("Claude is deciding the full production: script, voices, sound effects, music, and sonic logo...");
    try {
      let voices = providerVoices;
      if (!voices.length) {
        try { voices = await fetchElevenLabsVoices(); setProviderVoices(voices); } catch { voices = []; }
      }
      const plan = await generateLlmProductionPlan({ input, brief: project.brief as unknown as Record<string, unknown>, targetDuration: project.brief.targetDuration, voiceCatalog: voices });
      const scriptText = scriptTextFromLlmPlan(plan);
      setScriptDraft(scriptText);
      setProject((current) => applyLlmPlanToProject(current, plan));
      if (autoGenerate) {
        setLlmPlanMessage("Claude plan applied. Now generating all audio (voices, SFX, music, sonic logo)...");
        setIsLlmPlanning(false);
        setTimeout(() => generateAllAudioAndMix(), 100);
      } else {
        setLlmPlanMessage("Script aligned to each character below. Review it, then click Parse Script to lock in timing and voice roles.");
      }
    } catch (error) {
      setLlmPlanMessage(`Claude planning failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      if (!autoGenerate) setIsLlmPlanning(false);
    }
  };
  const handleScriptUpload = async (file?: File) => {
    if (!file) return;
    if (project.scriptLocked) {
      alert("Script is locked. Unlock it before uploading or replacing script text.");
      return;
    }
    if (!file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
      alert("This MVP accepts .txt and .md uploads. Paste DOCX text for now.");
      return;
    }
    const text = await file.text();
    setScriptDraft(text);
    setProject((current) => updateScriptFromText(current, text));
  };

  const handleProjectImport = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!isProjectLike(parsed)) {
        alert("That JSON does not look like a Napkin Audio AI Studio project package.");
        return;
      }
      const importedProject = recomputeProject(normalizeProject(parsed), `Imported project JSON: ${file.name}`);
      setProject(importedProject);
      setActiveTab("Studio");
    } catch {
      alert("Could not read that project JSON.");
    }
  };

  const proposeCommand = (rawCommand: string, source: "typed" | "audio" = "typed") => {
    const cleanCommand = rawCommand.trim();
    if (!cleanCommand) return;
    try {
      const proposal = parseCommand(cleanCommand, project);
      setLatestProposal(proposal);
      setProject((current) => ({
        ...current,
        commandLog: [proposal, ...current.commandLog],
        updatedAt: new Date().toISOString(),
      }));
      setVoiceCommandStatus(`Director received: "${cleanCommand}". Review the proposal below.`);
    } catch {
      setLatestProposal(null);
      setVoiceCommandStatus("No proposal generated. Try rephrasing your direction.");
    }
    if (source === "audio") {
      setLastVoiceTranscript(cleanCommand);
    }
    setCommandDraft("");
  };

  const addCommand = () => proposeCommand(commandDraft);

  const startNewProject = () => {
    if (!window.confirm("Start a new Napkin Audio AI Studio project and replace the browser autosave? Export JSON first if you need the current work.")) {
      return;
    }
    window.localStorage.removeItem(storageKey);
    legacyStorageKeys.forEach((key) => window.localStorage.removeItem(key));
    const freshProject = createProject();
    setProject(freshProject);
    setScriptDraft(freshProject.script.rawText);
    setActiveTab("Studio");
  };

  const updateCommandStatus = (commandId: string, status: "applied" | "rejected") => {
    setProject((current) => ({
      ...current,
      commandLog: current.commandLog.map((command) => (command.id === commandId ? { ...command, status } : command)),
      updatedAt: new Date().toISOString(),
    }));
  };

  const applyCommand = (commandId: string) => {
    setProject((current) => {
      const command = current.commandLog.find((item) => item.id === commandId);
      if (!command || command.status !== "proposed") return current;
      const scriptChangingIntents = ["remove-sfx", "slow-legal", "improve-ending", "tighten-script", "performance-note"];
      if (current.scriptLocked && scriptChangingIntents.includes(command.intent)) {
        return {
          ...current,
          commandLog: current.commandLog.map((item) => (item.id === commandId ? { ...item, status: "rejected" as const } : item)),
          updatedAt: new Date().toISOString(),
        };
      }
      const commandLog = current.commandLog.map((item) => (item.id === commandId ? { ...item, status: "applied" as const } : item));
      const targetLines = command.affectedLineIds.length
        ? command.affectedLineIds
        : current.script.lines.filter(lineSupportsVoiceRole).map((line) => line.id);

      if (command.intent === "change-voice") {
        const lower = command.rawCommand.toLowerCase();
        const accent = lower.includes("cork")
          ? "Cork"
          : lower.includes("dublin")
            ? "Dublin"
            : lower.includes("soft")
              ? "soft Irish"
              : current.brief.accentPreference;
        return recomputeProject(
          {
            ...current,
            commandLog,
            voiceRoles: current.voiceRoles.map((role, index) => (index === 0 ? { ...role, accent } : role)),
          },
          `Applied command: ${command.rawCommand}`,
        );
      }

      if (command.intent === "change-music") {
        return recomputeProject(
          {
            ...current,
            commandLog,
            musicCues: current.musicCues.map((cue) => ({
              ...cue,
              style: command.rawCommand.toLowerCase().includes("cinematic") ? "cinematic restrained bed" : cue.style,
              notes: `${cue.notes} Direction from command: ${command.rawCommand}`,
            })),
          },
          `Applied command: ${command.rawCommand}`,
        );
      }

      if (command.intent === "remove-sfx") {
        const script = retimeScript({
          ...current.script,
          rawText: current.script.lines
            .filter((line) => line.type !== "sound-effect")
            .map((line) => (line.speaker ? `${line.speaker}: ${line.text}` : line.text))
            .join("\n"),
          lines: current.script.lines.filter((line) => line.type !== "sound-effect"),
        });
        return recomputeProject(
          {
            ...current,
            commandLog,
            script,
            soundCues: [],
          },
          `Applied command: ${command.rawCommand}`,
        );
      }

      const script = retimeScript({
        ...current.script,
        lines: current.script.lines.map((line) => {
          if (!targetLines.includes(line.id)) return line;
          if (command.intent === "slow-legal" && line.type === "legal") {
            return {
              ...line,
              estimatedDuration: Number((line.estimatedDuration + 0.8).toFixed(1)),
              performanceNote: "Slow this legal line down. Clarity over speed.",
              warnings: line.warnings.filter((warning) => !warning.includes("Legal line speed")),
            };
          }
          if (command.intent === "improve-ending") {
            return {
              ...line,
              performanceNote: `${line.performanceNote} Make the ending land with a cleaner reveal and half a beat before the brand.`,
            };
          }
          if (command.intent === "tighten-script") {
            return {
              ...line,
              performanceNote: `${line.performanceNote} Tighten this line before recording; remove any word that does not move the idea.`,
            };
          }
          if (command.intent === "performance-note") {
            return {
              ...line,
              performanceNote: `${line.performanceNote} Direction from command: ${command.rawCommand}`,
            };
          }
          return line;
        }),
      });

      return recomputeProject({ ...current, commandLog, script }, `Applied command: ${command.rawCommand}`);
    });
  };

  const updateScriptLine = (lineId: string, updates: Partial<Project["script"]["lines"][number]>) => {
    setProject((current) => {
      if (current.scriptLocked) return current;
      const currentLine = current.script.lines.find((line) => line.id === lineId);
      if (!currentLine) return current;
      const hasChange = Object.entries(updates).some(([key, value]) => currentLine[key as keyof typeof currentLine] !== value);
      if (!hasChange) return current;
      const updatedLines = current.script.lines.map((line) => {
        if (line.id !== lineId) return line;
        const updatedLine = { ...line, ...updates };
        if (updates.type !== undefined) {
          updatedLine.assignedVoiceRoleId = voiceRoleIdForLine(updatedLine);
        }
        if (updates.text !== undefined || updates.type !== undefined) {
          return {
            ...updatedLine,
            estimatedDuration: estimateLineDuration(updatedLine.text, updatedLine.type === "legal"),
          };
        }
        return updatedLine;
      });
      const retimedScript = retimeScript({
        ...current.script,
        rawText: rawTextFromLines(updatedLines),
        lines: updatedLines,
      });
      const { script, voiceRoles } = assignVoiceRolesToScript(retimedScript, current.brief, current.voiceRoles, {
        preserveAssignedRoles: true,
      });
      return recomputeProject({ ...current, script, voiceRoles, soundCues: [] }, `Line ${currentLine.lineNumber} edited`);
    });
  };

  const addScriptLine = () => {
    setProject((current) => {
      if (current.scriptLocked) return current;
      const newLine: Project["script"]["lines"][number] = {
        id: createId("line"),
        lineNumber: current.script.lines.length + 1,
        text: "New line",
        type: "voiceover",
        assignedVoiceRoleId: current.voiceRoles[0]?.id,
        estimatedDuration: estimateLineDuration("New line"),
        startTime: 0,
        endTime: 0,
        emotionalIntent: ["clear"],
        performanceNote: "Conversational, specific, and human.",
        accentNote: current.brief.accentPreference,
        stressWords: [],
        pauseBefore: 0,
        pauseAfter: 0,
        warnings: [],
      };
      const lines = [...current.script.lines, newLine];
      const script = retimeScript({ ...current.script, rawText: rawTextFromLines(lines), lines });
      return recomputeProject({ ...current, script, soundCues: [] }, "Manual line added");
    });
  };

  const deleteScriptLine = (lineId: string) => {
    setProject((current) => {
      if (current.scriptLocked) return current;
      if (current.script.lines.length <= 1) return current;
      const line = current.script.lines.find((item) => item.id === lineId);
      const lines = current.script.lines.filter((item) => item.id !== lineId);
      const script = retimeScript({ ...current.script, rawText: rawTextFromLines(lines), lines });
      return recomputeProject({ ...current, script, soundCues: [] }, `Line ${line?.lineNumber ?? ""} deleted`);
    });
  };

  const addVoiceRole = () => {
    setProject((current) => {
      const roleNumber = current.voiceRoles.length + 1;
      const voiceRole: VoiceRole = {
        id: createId("voice"),
        roleName: `Custom voice ${roleNumber}`,
        characterDescription: "Describe the character, function, or casting route.",
        ageRange: "30-50",
        accent: current.brief.accentPreference || "neutral Irish",
        emotionalStyle: "conversational",
        pace: "conversational",
        performanceNotes: "Keep the performance grounded and specific.",
        pronunciationNotes: "",
        provider: "mock",
        rightsNotes: "Mock voice only. Confirm usage rights before production.",
      };
      return recomputeProject({ ...current, voiceRoles: [...current.voiceRoles, voiceRole] }, "Voice role added");
    });
  };

  const triggerAutoVoiceAssign = async () => {
    setAutoAssignStatus("Loading voices and assigning to script characters...");
    try {
      const voices = await fetchElevenLabsVoices();
      setProviderVoices(voices);
      const pool = voices.filter((v) => v.source === "elevenlabs").length > 0
        ? voices.filter((v) => v.source === "elevenlabs")
        : voices;

      setProject((current) => {
        const usedVoiceIds = new Set<string>();
        let poolIndex = 0;

        const nextUniqueVoice = () => {
          let attempts = 0;
          while (attempts < pool.length) {
            const candidate = pool[poolIndex % pool.length];
            poolIndex++;
            attempts++;
            if (!usedVoiceIds.has(candidate.voiceId)) {
              usedVoiceIds.add(candidate.voiceId);
              return candidate;
            }
          }
          const fallback = pool[poolIndex % pool.length];
          poolIndex++;
          return fallback;
        };

        const updatedRoles = current.voiceRoles.map((role) => {
          const isSharedRole = role.id === "voice-legal" || role.id.includes("mnemonic");
          const voice = isSharedRole
            ? pool[poolIndex++ % pool.length]
            : nextUniqueVoice();
          return {
            ...role,
            provider: "elevenlabs" as const,
            providerVoiceId: voice.voiceId,
            rightsNotes: `Auto-assigned: ${voice.name}. Confirm rights before production.`,
          };
        });

        const roleNames = updatedRoles.map((r) => {
          const v = pool.find((p) => p.voiceId === r.providerVoiceId);
          return `${r.roleName} → ${v?.name ?? "?"}`;
        });
        setAutoAssignStatus(
          `✓ ${updatedRoles.length} character${updatedRoles.length !== 1 ? "s" : ""} auto-assigned: ${roleNames.join(" · ")}`,
        );
        setProviderVoicesMessage(`${voices.length} voices loaded. ${updatedRoles.length} roles auto-assigned.`);

        return recomputeProject(
          { ...current, voiceRoles: updatedRoles },
          "Auto-assigned voices from script parse",
        );
      });
      // Switch to Voices tab so user sees the result immediately
      setActiveTab("Voices");
    } catch {
      setAutoAssignStatus("Could not load voices — proxy may not be running. Go to Voices tab and click Load & auto-assign voices manually.");
    }
  };

  const toggleScriptLock = () => {
    const willLock = !project.scriptLocked;
    setProject((current) =>
      recomputeProject(
        { ...current, scriptLocked: !current.scriptLocked },
        current.scriptLocked ? "Script unlocked for editing" : "Script locked against editing",
      ),
    );
    // When locking, auto-load voices and assign to detected roles
    if (willLock) {
      triggerAutoVoiceAssign();
    }
  };

  const [autoAssignStatus, setAutoAssignStatus] = useState("");

  const updateVoiceRole = (roleId: string, updates: Partial<VoiceRole>) => {
    setProject((current) => {
      const currentRole = current.voiceRoles.find((role) => role.id === roleId);
      if (!currentRole) return current;
      return recomputeProject(
        {
          ...current,
          voiceRoles: current.voiceRoles.map((role) => (role.id === roleId ? { ...role, ...updates } : role)),
        },
        `Voice role edited: ${currentRole.roleName}`,
      );
    });
  };

  const loadProviderVoices = async () => {
    setIsLoadingProviderVoices(true);
    setProviderVoicesMessage("Loading provider voices...");
    try {
      const voices = await fetchElevenLabsVoices();
      setProviderVoices(voices);
      const source = voices.some((voice) => voice.source === "elevenlabs") ? "ElevenLabs" : "mock";
      setProviderVoicesMessage(`${voices.length} ${source} voice option${voices.length === 1 ? "" : "s"} loaded. Click "Auto-assign voices" to give each character a different voice.`);
    } catch (error) {
      setProviderVoices([]);
      setProviderVoicesMessage(error instanceof Error ? error.message : "Could not load provider voices.");
    } finally {
      setIsLoadingProviderVoices(false);
    }
  };

  const autoAssignVoices = (voices: ProviderVoice[]) => {
    if (voices.length === 0) {
      setProviderVoicesMessage("Load voices first before auto-assigning.");
      return;
    }

    const pool = voices.filter((v) => v.source === "elevenlabs").length > 0
      ? voices.filter((v) => v.source === "elevenlabs")
      : voices;

    setProject((current) => {
      // Track which voiceIds have been used so no two named character roles share a voice
      const usedVoiceIds = new Set<string>();
      let poolIndex = 0;

      const nextUniqueVoice = () => {
        // Walk the pool until we find an unused voice (wrap around if needed)
        let attempts = 0;
        while (attempts < pool.length) {
          const candidate = pool[poolIndex % pool.length];
          poolIndex++;
          attempts++;
          if (!usedVoiceIds.has(candidate.voiceId)) {
            usedVoiceIds.add(candidate.voiceId);
            return candidate;
          }
        }
        // All voices used — allow reuse but still advance index
        const fallback = pool[poolIndex % pool.length];
        poolIndex++;
        return fallback;
      };

      const updatedRoles = current.voiceRoles.map((role) => {
        // Legal and mnemonic roles can share a voice — just pick next, no uniqueness needed
        const isSharedRole = role.id === "voice-legal" || role.id.includes("mnemonic");
        const voice = isSharedRole
          ? pool[poolIndex++ % pool.length]
          : nextUniqueVoice();

        return {
          ...role,
          provider: "elevenlabs" as const,
          providerVoiceId: voice.voiceId,
          rightsNotes: `Mapped to ElevenLabs voice: ${voice.name}. Confirm rights and client approval before production.`,
        };
      });

      return recomputeProject(
        { ...current, voiceRoles: updatedRoles },
        "Auto-assigned distinct voices to all roles",
      );
    });

    setProviderVoicesMessage(
      `✓ ${project.voiceRoles.length} role${project.voiceRoles.length > 1 ? "s" : ""} assigned — each character has a unique voice.`,
    );
  };

  const assignProviderVoiceToRole = (roleId: string, voiceId: string) => {
    const voice = providerVoices.find((item) => item.voiceId === voiceId);
    if (!voice) {
      updateVoiceRole(roleId, {
        provider: "mock",
        providerVoiceId: undefined,
        rightsNotes: "Mock voice only. Confirm usage rights before production.",
      });
      return;
    }
    updateVoiceRole(roleId, {
      provider: voice.source === "elevenlabs" ? "elevenlabs" : "mock",
      providerVoiceId: voice.voiceId,
      rightsNotes:
        voice.source === "elevenlabs"
          ? `Mapped to ElevenLabs voice ${voice.name}. Confirm rights, plan access, and client approval before production.`
          : `Mock casting reference: ${voice.name}. Select a real ElevenLabs voice before production.`,
    });
  };

  const startVoiceCommand = () => {
    type SpeechRecognitionCtor = new () => {
      lang: string;
      start: () => void;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
    };
    const browserWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceCommandStatus("Browser speech recognition is not available here. Typed commands still work.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-IE";
    setIsListening(true);
    setVoiceCommandStatus("Listening. Say a studio direction, for example: slow down the legal line.");
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setCommandDraft(transcript);
      proposeCommand(transcript, "audio");
    };
    recognition.onerror = () => {
      setIsListening(false);
      setVoiceCommandStatus("Voice command capture failed. Try again or type the direction.");
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const mockTakeForLine = async (line: Project["script"]["lines"][number], takeNumber: number, fallbackReason?: string) => {
    const provider = new MockVoiceProvider();
    const take = await provider.generateTake({
      roleId: line.assignedVoiceRoleId!,
      lineId: line.id,
      text: line.text,
      performanceNotes: line.performanceNote,
      takeNumber,
    });
    return {
      ...take,
      audioUrl: URL.createObjectURL(generateMockVoicePreviewBlob(line.text)),
      settings: { ...take.settings, syntheticPreview: true },
      notes: fallbackReason
        ? `Synthetic placeholder audio only. No speech was generated. Fallback reason: ${fallbackReason}`
        : "Synthetic placeholder audio only. No speech was generated.",
    };
  };

  const generateVoiceTake = async () => {
    const spokenTypes = new Set(["voiceover", "announcer", "character", "dialogue", "legal", "cta", "brand-mnemonic"]);
    const spokenLines = project.script.lines.filter(
      (line) => spokenTypes.has(line.type) && line.assignedVoiceRoleId && line.text.trim(),
    );
    if (spokenLines.length === 0) {
      setVoiceTakeMessage("No assigned voice lines found. Parse or assign voices before generating takes.");
      return;
    }
    setIsGeneratingVoiceTake(true);
    const newTakes: VoiceTake[] = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < spokenLines.length; i++) {
      const line = spokenLines[i];
      const role = project.voiceRoles.find((r) => r.id === line.assignedVoiceRoleId);
      const takeNumber = project.voiceTakes.length + newTakes.length + 1;
      setVoiceTakeMessage(`Generating line ${i + 1} of ${spokenLines.length}: ${line.speaker ?? role?.roleName ?? line.type}…`);

      try {
        const audioBlob = await generateElevenLabsSpeechPreview({
          text: line.text,
          voiceId: role?.provider === "elevenlabs" ? role.providerVoiceId : undefined,
          modelId: ttsModel,
          voiceSettings: {
            stability: role?.pace === "fast-read" ? 0.42 : 0.55,
            similarity_boost: 0.78,
            style: role?.emotionalStyle?.toLowerCase().includes("warm") ? 0.18 : 0.08,
            use_speaker_boost: true,
          },
        });
        newTakes.push({
          id: createId("take"),
          roleId: line.assignedVoiceRoleId!,
          lineId: line.id,
          takeNumber,
          provider: "elevenlabs",
          settings: {
            modelId: ttsModel,
            outputFormat: "mp3_44100_128",
            roleName: role?.roleName ?? "Assigned voice",
            lineNumber: line.lineNumber,
          },
          performanceNotes: line.performanceNote,
          audioUrl: URL.createObjectURL(audioBlob),
          isMock: false,
          isPreferred: false,
          notes: `Line ${line.lineNumber} — ${role?.roleName ?? line.type}. ElevenLabs preview via proxy.`,
          createdAt: new Date().toISOString(),
        });
        successCount++;
      } catch (error) {
        const fallbackReason = error instanceof Error ? error.message : "Provider unavailable.";
        const mockTake = await mockTakeForLine(line, takeNumber, fallbackReason);
        newTakes.push(mockTake);
        failCount++;
      }
    }

    setProject((current) =>
      recomputeProject(
        { ...current, voiceTakes: [...newTakes, ...current.voiceTakes] },
        `Generated takes for ${spokenLines.length} lines`,
      ),
    );
    setVoiceTakeMessage(
      failCount === 0
        ? `✓ ${successCount} takes generated — all ${spokenLines.length} lines across ${new Set(spokenLines.map((l) => l.assignedVoiceRoleId)).size} voice roles.`
        : `${successCount} ElevenLabs takes, ${failCount} mock fallback${failCount > 1 ? "s" : ""}. Check proxy and key.`,
    );
    setIsGeneratingVoiceTake(false);
  };

  const generateFullSpot = async () => {
    const spokenTypes = new Set(["voiceover", "announcer", "character", "dialogue", "legal", "cta", "brand-mnemonic"]);
    const spokenLines = project.script.lines.filter((line) => spokenTypes.has(line.type) && line.text.trim());
    if (spokenLines.length === 0) {
      setFullSpotMessage("No spoken lines found. Parse a script first.");
      return;
    }
    setIsGeneratingFullSpot(true);
    setFullSpotMessage(`Generating ${spokenLines.length} lines via ElevenLabs...`);
    try {
      const lines: FullSpotLine[] = spokenLines.map((line) => {
        const role = project.voiceRoles.find((r) => r.id === line.assignedVoiceRoleId);
        return {
          text: line.text,
          voiceId: role?.provider === "elevenlabs" ? role.providerVoiceId : undefined,
          voiceSettings: {
            stability: role?.pace === "fast-read" ? 0.42 : 0.55,
            similarity_boost: 0.78,
            style: role?.emotionalStyle?.toLowerCase().includes("warm") ? 0.18 : 0.08,
            use_speaker_boost: true,
          },
          pauseAfterMs: Math.round((line.pauseAfter ?? 0) * 1000) + 250,
        };
      });
      const blob = await generateElevenLabsFullSpot(lines);
      const filename = `${project.brief.brand.replace(/\W+/g, "-").toLowerCase() || "spot"}-full-spot.mp3`;
      downloadBlob(filename, blob);
      setFullSpotMessage(`Done — ${filename} downloaded. ${spokenLines.length} lines, ${(blob.size / 1024).toFixed(0)} KB.`);
    } catch (error) {
      setFullSpotMessage(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsGeneratingFullSpot(false);
    }
  };

  const downloadMixedAudio = () => {
    if (!mixedAudioUrl) return;
    const filename = `${project.brief.brand.replace(/\W+/g, "-").toLowerCase() || "spot"}-full-mix.mp3`;
    const a = document.createElement("a");
    a.href = mixedAudioUrl;
    a.download = filename;
    a.click();
  };


  const renderMixWithCustomAssets = async (
    targetProject: Project,
    customVoiceTakes: VoiceTake[],
    customSoundCues: SoundCue[],
    customMusicCues: MusicCue[]
  ) => {
    setMixRenderingMessage("Preparing audio assets for rendering...");
    setMixedAudioUrl(null);

    const voiceAssets = targetProject.script.lines
      .map((line) => {
        const lineTakes = customVoiceTakes.filter((t) => t.lineId === line.id && t.audioUrl);
        if (lineTakes.length === 0) return null;
        const sorted = [...lineTakes].sort((a, b) => b.takeNumber - a.takeNumber);
        return {
          type: "voice" as const,
          startTime: line.startTime,
          audioUrl: sorted[0].audioUrl!,
          label: `Line ${line.lineNumber} (${line.speaker || line.type})`,
          pitch: sorted[0].pitch,
          smoothing: sorted[0].smoothing,
        };
      })
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null);

    const sfxAssets = customSoundCues
      .filter((cue) => cue.audioUrl)
      .map((cue) => ({
        type: "sfx" as const,
        startTime: cue.startTime,
        endTime: cue.endTime,
        audioUrl: cue.audioUrl!,
        label: cue.label,
      }));

    const musicAssets = customMusicCues
      .filter((cue) => cue.audioUrl)
      .map((cue) => ({
        type: "music" as const,
        startTime: cue.startTime,
        endTime: cue.endTime,
        audioUrl: cue.audioUrl!,
        label: cue.label,
      }));

    const totalAssetsCount = voiceAssets.length + sfxAssets.length + musicAssets.length;
    if (totalAssetsCount === 0) {
      setMixRenderingMessage("No audio assets generated yet. Generate voice takes, SFX, and music first.");
      return;
    }

    try {
      // Decode using a real AudioContext — NOT OfflineAudioContext(2,1,sampleRate).
      // An OfflineAudioContext with length=1 throws NotSupportedError in Chrome/Safari
      // for MP3 blobs, causing every asset to silently fail and the mix to be pure silence.
      // AudioBuffers are transferable and work fine in any OfflineAudioContext afterward.
      const AudioCtxCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const decodeCtx = new AudioCtxCtor();
      const fetchAndDecode = async (url: string): Promise<AudioBuffer> => {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return await decodeCtx.decodeAudioData(arrayBuffer);
      };

      setMixRenderingMessage(`Decoding ${totalAssetsCount} audio files...`);
      const decodedAssets = await Promise.all(
        [...voiceAssets, ...sfxAssets, ...musicAssets].map(async (asset) => {
          try {
            const buffer = await fetchAndDecode(asset.audioUrl);
            return { ...asset, buffer };
          } catch (e) {
            console.error(`Failed to decode asset: ${asset.label}`, e);
            return null;
          }
        })
      );

      // Close the decode context — we only needed it for decoding
      try { decodeCtx.close(); } catch { /* already closed */ }

      const validAssets = decodedAssets.filter((a): a is NonNullable<typeof a> => a !== null);
      if (validAssets.length === 0) {
        throw new Error("Could not decode any audio assets.");
      }

      // Re-sequence voice lines back-to-back using their REAL decoded buffer length.
      // No gap between lines — the ElevenLabs audio already has natural leading/trailing
      // silence baked in. Adding extra gaps stacks up into minutes of dead air on long scripts.
      let voiceCursor = 0;
      const retimedVoice = validAssets
        .filter((asset) => asset.type === "voice")
        .map((asset) => {
          const start = voiceCursor;
          voiceCursor = start + asset.buffer.duration;
          return { ...asset, startTime: start };
        });
      let nextRetimedVoiceIndex = 0;
      const finalAssets = validAssets.map((asset) => {
        if (asset.type !== "voice") return asset;
        const retimed = retimedVoice[nextRetimedVoiceIndex];
        nextRetimedVoiceIndex += 1;
        return retimed;
      });

      // Canvas length = actual voice length only. Music/SFX are clamped to this.
      const lastVoiceEnd = voiceCursor;
      const duration = Math.max(lastVoiceEnd, 1);
      // Always render at 44100 Hz. Web Audio resamples buffers automatically when
      // their native rate differs from the context rate, so voice decoded at 44100
      // and music decoded at 22050 both play correctly in the same context.
      const sampleRate = 44100;
      const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);

      const dbToGain = (db: number) => Math.pow(10, db / 20);
      const voiceGainVal = dbToGain(targetProject.mixSettings.voiceLevel);
      const sfxGainVal = dbToGain(targetProject.mixSettings.sfxLevel);
      const musicGainVal = dbToGain(targetProject.mixSettings.musicLevel);

      // Real voice windows, using the retimed, ACTUAL decoded take length, so ducking lines up
      // with what will really play.
      const voiceWindows = retimedVoice
        .map((asset) => ({ start: asset.startTime, end: asset.startTime + asset.buffer.duration }))
        .sort((a, b) => a.start - b.start)
        .reduce<{ start: number; end: number }[]>((merged, window) => {
          const last = merged[merged.length - 1];
          if (last && window.start - last.end < 0.5) {
            last.end = Math.max(last.end, window.end);
          } else {
            merged.push({ ...window });
          }
          return merged;
        }, []);

      // Automatically duck (lower) a music or SFX track under any voice line it overlaps, then bring it
      // back up in the gaps — the "keep SFX naturalistic, keep music from fighting the voice" mix
      // principle from Studio Memory, applied for real instead of just noted.
      const applyDuckingEnvelope = (gainNode: GainNode, assetStart: number, assetEnd: number, normalGain: number) => {
        const duckGain = normalGain * 0.32; // roughly -10dB under the voice — present but out of the way
        const rampSeconds = 0.18;
        gainNode.gain.setValueAtTime(normalGain, assetStart);
        voiceWindows
          .map((w) => ({ start: Math.max(w.start, assetStart), end: Math.min(w.end, assetEnd) }))
          .filter((w) => w.end > w.start)
          .forEach((window) => {
            const rampDownAt = Math.max(assetStart, window.start - rampSeconds);
            const duckedAt = Math.min(window.start, assetEnd);
            const holdUntil = Math.min(window.end, assetEnd);
            const rampUpBy = Math.min(assetEnd, window.end + rampSeconds);
            gainNode.gain.setValueAtTime(normalGain, rampDownAt);
            gainNode.gain.linearRampToValueAtTime(duckGain, duckedAt);
            gainNode.gain.setValueAtTime(duckGain, holdUntil);
            gainNode.gain.linearRampToValueAtTime(normalGain, rampUpBy);
          });
      };

      setMixRenderingMessage("Mixing audio tracks...");
      finalAssets.forEach((asset) => {
        const start = Math.max(0, asset.startTime);
        // Clamp all assets to the canvas duration — nothing plays past voice end
        const naturalEnd = Math.min(start + asset.buffer.duration, duration);
        if (naturalEnd <= start) return; // asset starts after canvas end, skip it

        // Loop music/SFX that are shorter than the canvas so they fill it without silence gaps
        const assetLength = asset.buffer.duration;
        const needsLoop = asset.type !== "voice" && assetLength < (duration - start);

        const source = offlineCtx.createBufferSource();
        source.buffer = asset.buffer;
        if (needsLoop) {
          source.loop = true;
          source.loopStart = 0;
          source.loopEnd = assetLength;
        }

        if (asset.type === "voice" && asset.pitch) {
          if (asset.pitch === "low") source.playbackRate.value = 0.85;
          else if (asset.pitch === "high") source.playbackRate.value = 1.15;
        }

        let finalNode: AudioNode = source;
        if (asset.type === "voice" && typeof asset.smoothing === "number" && asset.smoothing > 0) {
          const filter = offlineCtx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = Math.max(1500, 20000 - asset.smoothing * 185);
          source.connect(filter);
          finalNode = filter;
        }

        const gainNode = offlineCtx.createGain();
        // stopAt is always ≤ duration — never let music/sfx play past voice end
        const stopAt = needsLoop ? duration : naturalEnd;

        if (asset.type === "voice") {
          gainNode.gain.value = voiceGainVal;
        } else if (asset.type === "sfx") {
          applyDuckingEnvelope(gainNode, start, stopAt, sfxGainVal);
        } else if (asset.type === "music") {
          applyDuckingEnvelope(gainNode, start, stopAt, musicGainVal);
        }

        finalNode.connect(gainNode);
        gainNode.connect(offlineCtx.destination);

        source.start(start);
        // Always set a hard stop so nothing bleeds past the canvas
        source.stop(stopAt);
      });

      setMixRenderingMessage("Rendering final stereo mix...");
      const renderedBuffer = await offlineCtx.startRendering();

      setMixRenderingMessage("Encoding MP3 package...");
      const mp3Blob = audioBufferToMp3(renderedBuffer);
      const url = URL.createObjectURL(mp3Blob);
      setMixedAudioUrl(url);
      setMixRenderingMessage(`✓ Mixed audio generated! (${duration.toFixed(1)}s)`);
    } catch (error) {
      console.error(error);
      setMixRenderingMessage(`Failed to render mix: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const renderFullMixedAudio = async () => {
    setIsRenderingMix(true);
    try {
      await renderMixWithCustomAssets(project, project.voiceTakes, project.soundCues, project.musicCues);
    } finally {
      setIsRenderingMix(false);
    }
  };

  const generateAllAudioAndMix = async () => {
    setIsGeneratingAllAndMixing(true);
    setGenerateAllAndMixMessage("Starting automated audio generation...");
    setMixedAudioUrl(null);

    let currentProject = project;

    // 1. Auto-assign voices to roles if unassigned
    const hasUnassignedRoles = currentProject.voiceRoles.some((role) => !role.providerVoiceId);
    if (hasUnassignedRoles || providerVoices.length === 0) {
      setGenerateAllAndMixMessage("Auto-assigning voices to roles...");
      try {
        let voices = providerVoices;
        if (voices.length === 0) {
          voices = await fetchElevenLabsVoices();
          setProviderVoices(voices);
        }
        
        const pool = voices.filter((v) => v.source === "elevenlabs").length > 0
          ? voices.filter((v) => v.source === "elevenlabs")
          : voices;

        const usedVoiceIds = new Set<string>();
        let poolIndex = 0;

        const nextUniqueVoice = () => {
          let attempts = 0;
          while (attempts < pool.length) {
            const candidate = pool[poolIndex % pool.length];
            poolIndex++;
            attempts++;
            if (!usedVoiceIds.has(candidate.voiceId)) {
              usedVoiceIds.add(candidate.voiceId);
              return candidate;
            }
          }
          return pool[poolIndex % pool.length];
        };

        const updatedRoles = currentProject.voiceRoles.map((role) => {
          const isSharedRole = role.id === "voice-legal" || role.id.includes("mnemonic");
          const voice = isSharedRole ? pool[poolIndex++ % pool.length] : nextUniqueVoice();
          return {
            ...role,
            provider: "elevenlabs" as const,
            providerVoiceId: voice.voiceId,
            rightsNotes: `Auto-assigned: ${voice.name}. Confirm rights before production.`,
          };
        });

        currentProject = recomputeProject(
          { ...currentProject, voiceRoles: updatedRoles },
          "Auto-assigned voices for all-in-one mix"
        );
      } catch (e) {
        console.warn("Casting failed. Fallback to mock voice configuration.", e);
      }
    }

    // 2. Generate Voice takes for all spoken script lines
    const spokenTypes = new Set(["voiceover", "announcer", "character", "dialogue", "legal", "cta", "brand-mnemonic"]);
    const spokenLines = currentProject.script.lines.filter(
      (line) => spokenTypes.has(line.type) && line.assignedVoiceRoleId && line.text.trim()
    );

    const newTakes: VoiceTake[] = [...currentProject.voiceTakes];
    for (let i = 0; i < spokenLines.length; i++) {
      const line = spokenLines[i];
      const role = currentProject.voiceRoles.find((r) => r.id === line.assignedVoiceRoleId);
      const takeNumber = newTakes.length + 1;
      setGenerateAllAndMixMessage(`Generating voice take ${i + 1} of ${spokenLines.length}: ${line.speaker ?? role?.roleName ?? line.type}…`);

      try {
        const audioBlob = await generateElevenLabsSpeechPreview({
          text: line.text,
          voiceId: role?.provider === "elevenlabs" ? role.providerVoiceId : undefined,
          modelId: ttsModel,
          voiceSettings: {
            stability: role?.pace === "fast-read" ? 0.42 : 0.55,
            similarity_boost: 0.78,
            style: role?.emotionalStyle?.toLowerCase().includes("warm") ? 0.18 : 0.08,
            use_speaker_boost: true,
          },
        });
        newTakes.push({
          id: createId("take"),
          roleId: line.assignedVoiceRoleId!,
          lineId: line.id,
          takeNumber,
          provider: "elevenlabs",
          settings: {
            modelId: ttsModel,
            outputFormat: "mp3_44100_128",
            roleName: role?.roleName ?? "Assigned voice",
            lineNumber: line.lineNumber,
          },
          performanceNotes: line.performanceNote,
          audioUrl: URL.createObjectURL(audioBlob),
          isMock: false,
          isPreferred: false,
          notes: `Line ${line.lineNumber} — ${role?.roleName ?? line.type}. ElevenLabs preview via proxy.`,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        const fallbackReason = error instanceof Error ? error.message : "Provider unavailable.";
        const mockTake = await mockTakeForLine(line, takeNumber, fallbackReason);
        newTakes.push(mockTake);
      }
    }

    // 3. Generate Sound Cues
    const newSoundCues = currentProject.soundCues.map((cue) => ({ ...cue }));
    for (let i = 0; i < newSoundCues.length; i++) {
      const cue = newSoundCues[i];
      setGenerateAllAndMixMessage(`Generating sound effect ${i + 1} of ${newSoundCues.length}: ${cue.label}…`);
      try {
        // Only pass durationSeconds if the cue has meaningful timing (>= 1s).
        // When startTime/endTime are both 0 (untimed script), omitting duration lets
        // ElevenLabs pick the natural length for the prompt instead of generating
        // an artificially short clip that sounds wrong or gets rejected.
        const cueDuration = cue.endTime - cue.startTime;
        const durationSeconds = cueDuration >= 1 ? Math.max(2, Math.min(22, cueDuration)) : undefined;
        const blob = await generateElevenLabsSoundEffect({
          text: cue.sfxMoment || cue.label,
          durationSeconds,
          promptInfluence: 0.4,
          modelId: sfxModel,
        });
        cue.audioUrl = URL.createObjectURL(blob);
      } catch (error) {
        // Retry once without durationSeconds — some prompts fail with an explicit duration
        try {
          const blob = await generateElevenLabsSoundEffect({
            text: cue.sfxMoment || cue.label,
            promptInfluence: 0.4,
            modelId: sfxModel,
          });
          cue.audioUrl = URL.createObjectURL(blob);
        } catch (retryError) {
          const fallbackReason = retryError instanceof Error ? retryError.message : "Provider unconfigured";
          cue.audioUrl = URL.createObjectURL(generateMockVoicePreviewBlob(`Sound Effect: ${cue.label}`));
          cue.notes = `${cue.notes || ""} [Mock Audio Fallback: ${fallbackReason}]`;
        }
      }
    }

    // 4. Generate Music Cues
    const newMusicCues = currentProject.musicCues.map((cue) => ({ ...cue }));
    for (let i = 0; i < newMusicCues.length; i++) {
      const cue = newMusicCues[i];
      setGenerateAllAndMixMessage(`Composing music track ${i + 1} of ${newMusicCues.length}: ${cue.label}…`);
      try {
        const lengthMs = Math.max(3000, Math.min(600000, Math.round((cue.endTime - cue.startTime) * 1000)));
        const prompt = cue.notes && cue.notes.length > 20 ? cue.notes : `${cue.style}, ${cue.mood}, ${cue.instrumentation}, tempo: ${cue.tempo}`;
        const blob = await generateElevenLabsMusic({
          prompt,
          musicLengthMs: lengthMs,
          modelId: musicModel,
        });
        cue.audioUrl = URL.createObjectURL(blob);
      } catch (error) {
        const fallbackReason = error instanceof Error ? error.message : "Provider unconfigured";
        cue.audioUrl = URL.createObjectURL(generateMockVoicePreviewBlob(`Music: ${cue.label}`));
        cue.notes = `${cue.notes || ""} [Mock Audio Fallback: ${fallbackReason}]`;
      }
    }

    setGenerateAllAndMixMessage("Updating project state with generated assets...");
    setProject((current) => {
      return recomputeProject({
        ...current,
        voiceRoles: currentProject.voiceRoles,
        voiceTakes: newTakes,
        soundCues: newSoundCues,
        musicCues: newMusicCues,
      }, "Generated all assets and rendered full mix");
    });

    setGenerateAllAndMixMessage("Rendering stereo mix...");
    try {
      await renderMixWithCustomAssets(currentProject, newTakes, newSoundCues, newMusicCues);
      setGenerateAllAndMixMessage("✓ Automated audio generation & mix completed!");
    } catch (e) {
      console.error(e);
      setGenerateAllAndMixMessage(`Generation completed, but mix rendering failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setIsGeneratingAllAndMixing(false);
    }
  };

  const autoGenerateSoundCues = () => {
    setProject((current) => {
      const sound = SoundDesignAgent.buildCues({
        ...current,
        soundCues: [],
        musicCues: []
      });
      return recomputeProject(
        { ...current, soundCues: sound.soundCues, musicCues: sound.musicCues },
        "Sound cues auto-detected and rebuilt by AI"
      );
    });
    setSoundDesignMessage("✓ Rebuilt and auto-detected sound cues from script content.");
  };

  const transformVoVoice = async () => {
    if (!voiceSourceFile) {
      setVoiceTransformMessage("Add a VO source recording first.");
      return;
    }
    if (!voiceTransformConsent) {
      setVoiceTransformMessage("Confirm VO consent and usage rights before transforming a voice.");
      return;
    }
    const targetRole = project.voiceRoles.find((role) => role.id === voiceTransformTargetRoleId);
    const query = new URLSearchParams({ outputFormat: "mp3_44100_128" });
    if (targetRole?.provider === "elevenlabs" && targetRole.providerVoiceId) query.set("voiceId", targetRole.providerVoiceId);
    const formData = new FormData();
    formData.set("audio", voiceSourceFile);
    formData.set("model_id", "eleven_multilingual_sts_v2");
    formData.set("remove_background_noise", "true");
    setVoiceTransformMessage("Transforming VO through the server proxy...");
    try {
      const response = await fetch(`${providerProxyBaseUrl}/api/voice/elevenlabs/voice-changer?${query.toString()}`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const detail = await response.text();
        setVoiceTransformMessage(`Voice transform failed (${response.status}). ${detail.slice(0, 160)}`);
        return;
      }
      const audioBlob = await response.blob();
      if (voiceTransformAudioUrl) URL.revokeObjectURL(voiceTransformAudioUrl);
      setVoiceTransformAudioUrl(URL.createObjectURL(audioBlob));
      setVoiceTransformMessage("Transformed VO preview ready. Review performance and rights before using it.");
    } catch {
      setVoiceTransformMessage(`Provider proxy unavailable at ${providerProxyBaseUrl}.`);
    }
  };

  const applyAutoMix = () => {
    setProject((current) =>
      recomputeProject(
        { ...current, mixSettings: MixEngineerAgent.autoMix(current) },
        "Producer Assistant auto-mix baseline applied",
      ),
    );
  };

  // SOUND CUE STATE HANDLERS
  const addSoundCue = () => {
    setProject((current) => {
      const cueId = createId("sfx");
      const newCue: SoundCue = {
        id: cueId,
        label: "New Sound Cue",
        location: "Scripted moment",
        texture: "Natural, not cluttered",
        sfxMoment: "describe the sound effect",
        foley: "Confirm in production",
        startTime: 0,
        endTime: 2,
        notes: "Check that this supports the voice.",
      };
      return recomputeProject(
        { ...current, soundCues: [...current.soundCues, newCue] },
        "Sound cue added manually"
      );
    });
  };

  const updateSoundCue = (cueId: string, updates: Partial<SoundCue>) => {
    setProject((current) => {
      const updatedCues = current.soundCues.map((cue) =>
        cue.id === cueId ? { ...cue, ...updates } : cue
      );
      return recomputeProject(
        { ...current, soundCues: updatedCues },
        `Sound cue updated`
      );
    });
  };

  const deleteSoundCue = (cueId: string) => {
    setProject((current) => {
      const updatedCues = current.soundCues.filter((cue) => cue.id !== cueId);
      return recomputeProject(
        { ...current, soundCues: updatedCues },
        "Sound cue deleted"
      );
    });
  };

  // MUSIC CUE STATE HANDLERS
  const addMusicCue = () => {
    setProject((current) => {
      const cueId = createId("music");
      const newCue: MusicCue = {
        id: cueId,
        label: "New Music Cue",
        style: "warm contemporary",
        tempo: "measured",
        instrumentation: "acoustic guitar, light pads",
        mood: "warm",
        startTime: 0,
        endTime: current.brief.targetDuration,
        notes: "Keep space around voice.",
      };
      return recomputeProject(
        { ...current, musicCues: [...current.musicCues, newCue] },
        "Music cue added manually"
      );
    });
  };

  const updateMusicCue = (cueId: string, updates: Partial<MusicCue>) => {
    setProject((current) => {
      const updatedCues = current.musicCues.map((cue) =>
        cue.id === cueId ? { ...cue, ...updates } : cue
      );
      return recomputeProject(
        { ...current, musicCues: updatedCues },
        `Music cue updated`
      );
    });
  };

  const deleteMusicCue = (cueId: string) => {
    setProject((current) => {
      const updatedCues = current.musicCues.filter((cue) => cue.id !== cueId);
      return recomputeProject(
        { ...current, musicCues: updatedCues },
        "Music cue deleted"
      );
    });
  };

  // AI CUE AUDIO GENERATION
  const generateSoundCueAudio = async (cueId: string) => {
    const cue = project.soundCues.find((c) => c.id === cueId);
    if (!cue) return;
    setGeneratingSfxCueId(cueId);
    setSoundDesignMessage(`Generating SFX for: ${cue.label}...`);
    try {
      // Only pass durationSeconds when timing is meaningful (>= 1s gap).
      // Zero/untimed cues (startTime=endTime=0) should let ElevenLabs pick natural length.
      const cueDuration = cue.endTime - cue.startTime;
      const durationSeconds = cueDuration >= 1 ? Math.max(2, Math.min(22, cueDuration)) : undefined;
      const blob = await generateElevenLabsSoundEffect({
        text: cue.sfxMoment || cue.label,
        durationSeconds,
        promptInfluence: 0.4,
        modelId: sfxModel,
      });
      const audioUrl = URL.createObjectURL(blob);
      updateSoundCue(cueId, { audioUrl });
      setSoundDesignMessage(`✓ Generated sound effect: ${cue.label}`);
    } catch (error) {
      // Retry once without durationSeconds constraint
      try {
        const blob = await generateElevenLabsSoundEffect({
          text: cue.sfxMoment || cue.label,
          promptInfluence: 0.4,
          modelId: sfxModel,
        });
        const audioUrl = URL.createObjectURL(blob);
        updateSoundCue(cueId, { audioUrl });
        setSoundDesignMessage(`✓ Generated sound effect (retry): ${cue.label}`);
      } catch (retryError) {
        const fallbackReason = retryError instanceof Error ? retryError.message : "Provider unconfigured";
        const audioUrl = URL.createObjectURL(generateMockVoicePreviewBlob(`Sound Effect: ${cue.label}`));
        updateSoundCue(cueId, {
          audioUrl,
          notes: `${cue.notes || ""} [Mock Audio Fallback: ${fallbackReason}]`,
        });
        setSoundDesignMessage(`Fallback: Generated mock placeholder for ${cue.label}`);
      }
    } finally {
      setGeneratingSfxCueId(null);
    }
  };

  const generateMusicCueAudio = async (cueId: string) => {
    const cue = project.musicCues.find((c) => c.id === cueId);
    if (!cue) return;
    setGeneratingMusicCueId(cueId);
    setSoundDesignMessage(`Composing music for: ${cue.label}...`);
    try {
      const lengthMs = Math.max(3000, Math.min(600000, Math.round((cue.endTime - cue.startTime) * 1000)));
      const prompt = `${cue.style}, ${cue.mood}, ${cue.instrumentation}, tempo: ${cue.tempo}`;
      const blob = await generateElevenLabsMusic({
        prompt,
        musicLengthMs: lengthMs,
        modelId: musicModel,
      });
      const audioUrl = URL.createObjectURL(blob);
      updateMusicCue(cueId, { audioUrl });
      setSoundDesignMessage(`✓ Composed music: ${cue.label}`);
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : "Provider unconfigured";
      const audioUrl = URL.createObjectURL(generateMockVoicePreviewBlob(`Music: ${cue.label}`));
      updateMusicCue(cueId, {
        audioUrl,
        notes: `${cue.notes || ""} [Mock Audio Fallback: ${fallbackReason}]`,
      });
      setSoundDesignMessage(`Fallback: Generated mock placeholder for ${cue.label}`);
    } finally {
      setGeneratingMusicCueId(null);
    }
  };

  const updateVoiceTake = (takeId: string, updates: Partial<VoiceTake>) => {
    setProject((current) => {
      const updatedTakes = current.voiceTakes.map((take) =>
        take.id === takeId ? { ...take, ...updates } : take
      );
      return recomputeProject(
        { ...current, voiceTakes: updatedTakes },
        `Voice take settings updated`
      );
    });
  };

  const stopProcessedVoicePlayback = () => {
    if (activeSourceNode) {
      try {
        activeSourceNode.stop();
      } catch (e) {
        // Already stopped
      }
      activeSourceNode = null;
    }
    if (activeAudioContext) {
      try {
        activeAudioContext.close();
      } catch (e) {
        // Already closed
      }
      activeAudioContext = null;
    }
    setPlayingVoiceTakeId(null);
  };

  const playProcessedVoice = async (take: VoiceTake) => {
    stopProcessedVoicePlayback();
    if (!take.audioUrl) {
      setSoundDesignMessage(`No audio available for Take ${take.takeNumber}. Generate it in Voices tab first.`);
      return;
    }

    setPlayingVoiceTakeId(take.id);
    setSoundDesignMessage(`Loading Take ${take.takeNumber} processing context...`);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      activeAudioContext = ctx;

      const response = await fetch(take.audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      if (activeAudioContext !== ctx) return;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      activeSourceNode = source;

      // Pitch shifting
      const pitch = take.pitch ?? "normal";
      if (pitch === "low") {
        source.playbackRate.value = 0.85;
      } else if (pitch === "high") {
        source.playbackRate.value = 1.15;
      } else {
        source.playbackRate.value = 1.0;
      }

      // Voice smoothing filter
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      const smoothing = take.smoothing ?? 0;
      const cutoffFreq = 20000 - (smoothing * 185);
      filter.frequency.value = Math.max(1500, cutoffFreq);

      source.connect(filter);
      filter.connect(ctx.destination);

      source.onended = () => {
        if (activeSourceNode === source) {
          setPlayingVoiceTakeId(null);
        }
      };

      source.start(0);
      setSoundDesignMessage(`✓ Playing Take ${take.takeNumber} (Pitch: ${pitch}, Smoothing: ${smoothing}%)`);
    } catch (error) {
      setSoundDesignMessage(`Error processing audio: ${error instanceof Error ? error.message : "decode error"}`);
      stopProcessedVoicePlayback();
    }
  };

  const stopTransport = () => {
    setIsTransportPlaying(false);
    setTransportTime(0);
  };

  const jumpTransportToLine = (startTime: number) => {
    setTransportTime(Math.min(startTime, transportDuration));
    setIsTransportPlaying(false);
  };

  const checkProviderStatus = async () => {
    setProviderStatusMessage("Checking provider proxy and the Claude API...");
    try {
      const status = await fetchProviderStatus();
      setProviderStatus(status);
      const elevenLabsNote = status.elevenLabs.configured
        ? "ElevenLabs key detected. Server-side routes are available for speech, SFX, and music."
        : "ElevenLabs key not detected. Mock provider remains active.";
      const claudeNote = !status.claude
        ? ""
        : !status.claude.configured
          ? " ANTHROPIC_API_KEY is not set — add it to .env to enable production planning."
          : !status.claude.reachable
            ? ` Claude API is NOT reachable — ${status.claude.error ?? "check ANTHROPIC_API_KEY and your network connection."}`
            : ` Claude ("${status.claude.model}") is reachable — ready to generate.`;
      setProviderStatusMessage(`${elevenLabsNote}${claudeNote}`);
    } catch (error) {
      setProviderStatus(null);
      setProviderStatusMessage(
        `Provider proxy unavailable at ${providerProxyBaseUrl}. Run npm run server after adding .env values.`,
      );
    }
  };

  const projectFileBase = () => project.brief.brand.replace(/\W+/g, "-").toLowerCase() || "napkin-audio-project";

  const exportDocument = (kind: "script" | "cue-sheet" | "qc" | "craft" | "notes" | "json") => {
    const base = projectFileBase();
    if (kind === "script") downloadText(`${base}-script.md`, scriptMarkdown(project));
    if (kind === "cue-sheet") downloadText(`${base}-cue-sheet.md`, cueSheetMarkdown(project));
    if (kind === "qc") downloadText(`${base}-qc-report.md`, qcMarkdown(project));
    if (kind === "craft") downloadText(`${base}-craft-quality.md`, craftQualityMarkdown(project));
    if (kind === "notes") downloadText(`${base}-production-notes.md`, productionNotesMarkdown(project));
    if (kind === "json") downloadBlob(`${base}-project.json`, exportProjectJson(project));
  };

  const showProductionToolbar = productionTabs.includes(activeTab);
  const qcFailCount = project.qcResults.filter((item) => item.status === "fail").length;
  const qcWarnCount = project.qcResults.filter((item) => item.status === "warn").length;

  const proposedCommands = project.commandLog.filter((command) => command.status === "proposed");

  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <ParticleField theme={theme} />
      <div className={`app-layout${sidebarOpen ? " sidebar-open" : ""}`}>
      <aside className="sidebar">
        <button
          className="sidebar-close icon-button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        >
          <Square size={16} />
        </button>
        <div className="sidebar-brand">
          <Wand2 size={20} />
          <div>
            <strong>{productName}</strong>
            <small>Radio ad studio</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {sidebarSections.map((section) => (
            <div className="sidebar-section" key={section.heading}>
              <p className="sidebar-heading">{section.heading}</p>
              {section.items.map((tab) => (
                <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => { setActiveTab(tab); setSidebarOpen(false); }}>
                  {tabIcons[tab]} {tab}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-preview">
          <p className="sidebar-heading">Preview</p>
          <div className="preview-clock">
            <strong>{formatTimecode(transportTime)}</strong>
            <small>/ {formatTimecode(transportDuration)}</small>
          </div>
          <WaveformScrubber
            duration={transportDuration}
            currentTime={transportTime}
            lines={project.script.lines}
            theme={theme}
            onSeek={(time) => {
              setTransportTime(time);
              setIsTransportPlaying(false);
            }}
          />
          <div className="preview-controls">
            <button className="primary" onClick={() => setIsTransportPlaying((current) => !current)}>
              {isTransportPlaying ? <Pause size={16} /> : <Play size={16} />}
              {isTransportPlaying ? "Pause" : "Play"}
            </button>
            <button onClick={stopTransport}>
              <Square size={14} />
            </button>
          </div>
          <small className="preview-line">
            {activeTransportLine
              ? `Line ${activeTransportLine.lineNumber}: ${(activeTransportLine.speaker ?? activeTransportLine.type).toString()}`
              : "No parsed line selected"}
          </small>
        </div>
      </aside>

      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button hamburger-button"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <LayoutDashboard size={18} />
            </button>
            {isEditingTitle ? (
              <input
                autoFocus
                defaultValue={project.brief.projectName}
                onBlur={(event) => {
                  setProject((p) => setBriefField(p, "projectName", event.target.value || p.brief.projectName));
                  setIsEditingTitle(false);
                }}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              />
            ) : (
              <>
                <h1>{project.brief.projectName}</h1>
                <button aria-label="Rename project" className="icon-button" onClick={() => setIsEditingTitle(true)}>
                  <Pencil size={15} />
                </button>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <span className="save-indicator">
              <CheckCircle2 size={14} /> Saved
            </span>
            <button
              type="button"
              className="icon-button theme-toggle"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="segmented" aria-label="Mode">
              <button className={mode === "creative" ? "active" : ""} onClick={() => setMode("creative")}>
                Creative
              </button>
              <button className={mode === "producer" ? "active" : ""} onClick={() => setMode("producer")}>
                Producer
              </button>
            </div>
            <button onClick={startNewProject}>New Project</button>
            <label className="file-button">
              Import JSON
              <input type="file" accept="application/json,.json" onChange={(event) => handleProjectImport(event.target.files?.[0])} />
            </label>
            <button className="primary" onClick={() => exportDocument("json")}>
              <Download size={16} /> Export
            </button>
          </div>
        </header>

        <p className="tab-context">{tabDescriptions[activeTab]}</p>

        <div className="workspace">
          <main className="workspace-main">
      {activeTab === "Studio" && (
        <section className="studio-page">
          <div className="metric-row">
            <div className="metric-tile">
              <span className="metric-tile-label"><Timer size={14} /> Duration</span>
              <strong>{project.brief.targetDuration}s</strong>
              <button className="link-button" onClick={() => setActiveTab("Brief")}>Change</button>
            </div>
            <div className="metric-tile">
              <span className="metric-tile-label"><FileAudio size={14} /> Script length</span>
              <strong>{project.script.estimatedDuration}s</strong>
              <small>Current read</small>
            </div>
            <div className="metric-tile">
              <span className="metric-tile-label"><CheckCircle2 size={14} /> Status</span>
              <strong>{project.approvalStatus}</strong>
            </div>
            <div className="metric-tile">
              <span className="metric-tile-label"><ShieldCheck size={14} /> Compliance</span>
              <strong>{qcFailCount > 0 ? "Needs fixes" : "Broadcast ready"}</strong>
              <button className="link-button" onClick={() => setActiveTab("Compliance")}>See full report</button>
            </div>
            <div className="metric-tile metric-tile-score">
              <span className="metric-tile-label"><Gauge size={14} /> AI score</span>
              <div className="score-ring">
                <strong>{project.craftQuality.overallScore}</strong>
              </div>
              <small>{project.craftQuality.scoreBand}</small>
            </div>
          </div>

          <div className="studio-grid" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
            <Panel title="Brief" icon={<ClipboardList size={18} />} detail={project.craftQuality.nextBestCraftMove}>
              <p className="large-note">
                {project.brief.brand || "Untitled brand"}
                {project.brief.productService ? ` — ${project.brief.productService}.` : "."}
                {project.brief.tone ? ` Tone: ${project.brief.tone}.` : ""}
                {project.brief.audience ? ` Audience: ${project.brief.audience}.` : ""}
              </p>
              <button onClick={() => setActiveTab("Brief")}>Edit brief</button>
            </Panel>
            <div className="llm-planner quick-generate">
              <label>
                Describe anything — Claude decides the rest
                <input
                  value={llmInput}
                  disabled={isLlmPlanning || isGeneratingAllAndMixing}
                  onChange={(event) => setLlmInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && llmInput.trim() && generateScriptVoiceAndSoundWithLlm(true)}
                  placeholder="A 30-second ad for a camper van brand, warm and adventurous..."
                />
              </label>
              <button className="primary" disabled={isLlmPlanning || isGeneratingAllAndMixing || !llmInput.trim()} onClick={() => generateScriptVoiceAndSoundWithLlm(true)}>
                <Sparkles size={16} /> {isLlmPlanning ? "Deciding..." : isGeneratingAllAndMixing ? "Generating..." : "Generate full production"}
              </button>
              {(isLlmPlanning || isGeneratingAllAndMixing) && <small>{isLlmPlanning ? llmPlanMessage : generateAllAndMixMessage}</small>}
              {mixedAudioUrl && <audio controls src={mixedAudioUrl} style={{ width: "100%", marginTop: "0.5rem" }} />}
            </div>
          </div>

          <Panel title="Timeline" icon={<SlidersHorizontal size={18} />} detail="Every voice, SFX, and music block laid out across the ad's runtime.">
            <div className="timeline">
              {project.timeline.map((block) => (
                <div
                  className={`timeline-block ${block.warningStatus ?? "ok"}`}
                  key={block.id}
                  style={{
                    left: `${Math.min(96, (block.start / project.brief.targetDuration) * 100)}%`,
                    width: `${Math.max(4, ((block.end - block.start) / project.brief.targetDuration) * 100)}%`,
                  }}
                  title={`${block.label}: ${block.notes}`}
                >
                  {block.label}
                </div>
              ))}
            </div>
            <small>0.0s to {project.brief.targetDuration}.0s</small>
          </Panel>

          <div className="quick-card-row">
            <div className="quick-card">
              <span className="quick-card-icon"><Mic size={16} /></span>
              <strong>Voice</strong>
              <p>{project.voiceRoles[0] ? `${project.voiceRoles[0].roleName} · ${project.voiceRoles[0].accent}` : "No voices cast yet"}</p>
              <div className="tool-stack">
                <button onClick={() => setActiveTab("Voices")}>Change</button>
              </div>
            </div>
            <div className="quick-card">
              <span className="quick-card-icon"><Music2 size={16} /></span>
              <strong>Sound design</strong>
              <p>{project.soundCues.length} SFX cue{project.soundCues.length === 1 ? "" : "s"} · {project.musicCues.length} music cue{project.musicCues.length === 1 ? "" : "s"}</p>
              <div className="tool-stack">
                <button onClick={() => setActiveTab("Sound Design")}>Edit</button>
              </div>
            </div>
            <div className="quick-card">
              <span className="quick-card-icon"><SlidersHorizontal size={16} /></span>
              <strong>Auto mix</strong>
              <p>Loudness target {project.mixSettings.loudnessTarget}</p>
              <div className="tool-stack">
                <button className="primary" onClick={applyAutoMix}>Auto-mix for radio</button>
              </div>
            </div>
            <div className="quick-card">
              <span className="quick-card-icon"><ShieldCheck size={16} /></span>
              <strong>Compliance</strong>
              <p>{qcFailCount} failure{qcFailCount === 1 ? "" : "s"} · {qcWarnCount} warning{qcWarnCount === 1 ? "" : "s"}</p>
              <div className="tool-stack">
                <button onClick={() => setActiveTab("Compliance")}>View report</button>
              </div>
            </div>
            <div className="quick-card">
              <span className="quick-card-icon"><PackageCheck size={16} /></span>
              <strong>Export</strong>
              <p>Script, cue sheet, and project files</p>
              <div className="tool-stack">
                <button onClick={() => setActiveTab("Export")}>Quick export</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === "Brief" && (
        <section className="panel">
          <SectionHeader title="Brief" detail="Shape the job before the script tries to solve it." />
          <div className="form-grid">
            <TextField label="Project name" value={project.brief.projectName} onChange={(value) => setProject((p) => setBriefField(p, "projectName", value))} />
            <TextField label="Client" value={project.brief.client} onChange={(value) => setProject((p) => setBriefField(p, "client", value))} />
            <TextField label="Brand" value={project.brief.brand} onChange={(value) => setProject((p) => setBriefField(p, "brand", value))} />
            <TextField label="Campaign" value={project.brief.campaign} onChange={(value) => setProject((p) => setBriefField(p, "campaign", value))} />
            <TextField label="Product/service" value={project.brief.productService} onChange={(value) => setProject((p) => setBriefField(p, "productService", value))} />
            <TextField label="Audience" value={project.brief.audience} onChange={(value) => setProject((p) => setBriefField(p, "audience", value))} />
            <TextField label="Tone" value={project.brief.tone} onChange={(value) => setProject((p) => setBriefField(p, "tone", value))} />
            <TextField label="Emotional response" value={project.brief.desiredEmotionalResponse} onChange={(value) => setProject((p) => setBriefField(p, "desiredEmotionalResponse", value))} />
            <label>
              Duration
              <select
                value={project.brief.targetDuration}
                onChange={(event) => {
                  const targetDuration = Number(event.target.value);
                  setProject((p) => updateScriptFromText(setBriefField(p, "targetDuration", targetDuration), p.script.rawText));
                }}
              >
                {durations.map((duration) => (
                  <option key={duration} value={duration}>
                    {duration} seconds
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Accent preference" value={project.brief.accentPreference} onChange={(value) => setProject((p) => setBriefField(p, "accentPreference", value))} />
            <TextArea label="Mandatory phrases" value={project.brief.mandatoryPhrases.join("\n")} onChange={(value) => setProject((p) => setBriefField(p, "mandatoryPhrases", value.split("\n").filter(Boolean)))} />
            <TextArea label="Legal lines" value={project.brief.legalLines.join("\n")} onChange={(value) => setProject((p) => setBriefField(p, "legalLines", value.split("\n").filter(Boolean)))} />
            <TextArea label="Brand voice notes" value={project.brief.brandVoiceNotes} onChange={(value) => setProject((p) => setBriefField(p, "brandVoiceNotes", value))} />
            <TextArea label="Sonic logo notes" value={project.brief.sonicLogoNotes} onChange={(value) => setProject((p) => setBriefField(p, "sonicLogoNotes", value))} />
          </div>
        </section>
      )}

      {activeTab === "Script" && (
        <section className="studio-grid script-layout">
          <Panel title="1. Script Intake" icon={<Upload size={18} />} detail="Write, paste, or upload the script, then lock it once it's ready for production.">
            <div className="upload-row">
              <button className={project.scriptLocked ? "" : "primary"} onClick={toggleScriptLock}>
                {project.scriptLocked ? <Unlock size={18} /> : <Lock size={18} />}
                {project.scriptLocked ? "Unlock script" : "Lock script"}
              </button>
              <label className="file-button" aria-disabled={project.scriptLocked}>
                Upload .txt / .md
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  disabled={project.scriptLocked}
                  onChange={(event) => handleScriptUpload(event.target.files?.[0])}
                />
              </label>
              <button disabled={project.scriptLocked} onClick={addScriptLine}>Add Line</button>
            </div>
            <p className={project.scriptLocked ? "good-text" : "large-note"}>
              {project.scriptLocked
                ? "Script is locked. Unlock it before editing, reparsing, uploading, adding, or deleting lines."
                : "Script is editable. Lock it before recording or client review to prevent accidental changes."}
            </p>
            <div className="llm-planner">
              <label>
                Describe anything — Claude will decide everything automatically
                <textarea
                  value={llmInput}
                  disabled={project.scriptLocked || isLlmPlanning || isGeneratingAllAndMixing}
                  onChange={(event) => setLlmInput(event.target.value)}
                  placeholder="Type anything: a product idea, a concept, a brand name, a story — Claude will autonomously decide the full script, who speaks, where sound effects go, music placement, and sonic logo. Example: 'A 30-second ad for artisan coffee delivery. Target: young professionals. Warm and witty tone.'"
                />
              </label>
              <div className="tool-stack">
                <button className="primary" disabled={project.scriptLocked || isLlmPlanning || isGeneratingAllAndMixing} onClick={() => generateScriptVoiceAndSoundWithLlm(false)}>
                  <Sparkles size={18} /> {isLlmPlanning ? "Aligning script to characters..." : "Generate & Align Script"}
                </button>
              </div>
              <p className={llmPlanMessage.toLowerCase().includes("failed") || llmPlanMessage.toLowerCase().includes("could not") ? "warning-text" : "large-note"}>{llmPlanMessage}</p>
              {isGeneratingAllAndMixing && <p className="large-note">{generateAllAndMixMessage}</p>}
            </div>
            {autoAssignStatus && (
              <p className="large-note" style={{ marginTop: "0.25rem" }}>{autoAssignStatus}</p>
            )}
            <div className="script-editor-shell">
              <textarea
                className="script-input"
                value={scriptDraft}
                readOnly={project.scriptLocked}
                onChange={(event) => setScriptDraft(event.target.value)}
                placeholder="Your character-aligned script will appear here after you upload a file or click Generate & Align Script above — one line per speaker, e.g. ANNOUNCER: Wake up to something better."
              />
              <button className={`script-lock-fab ${project.scriptLocked ? "locked" : ""}`} onClick={toggleScriptLock}>
                {project.scriptLocked ? <Unlock size={18} /> : <Lock size={18} />}
                {project.scriptLocked ? "Unlock script" : "Lock script"}
              </button>
            </div>
            <div className="tool-stack" style={{ marginTop: "0.75rem" }}>
              <button className="primary" disabled={project.scriptLocked} onClick={() => {
                setProject((p) => updateScriptFromText(p, scriptDraft));
                triggerAutoVoiceAssign();
              }}>
                <FileAudio size={18} /> Parse Script
              </button>
            </div>
          </Panel>
          <Panel title="2. Parse, Timing & Roles" icon={<Radio size={18} />} detail="Every parsed line, with its type, assigned voice, timing, and any warnings.">

            <Metric label="Estimated runtime" value={`${project.script.estimatedDuration}s`} />
            <Metric label="Words/sec" value={String(project.script.wordsPerSecond)} />
            <p className={project.script.estimatedDuration > project.brief.targetDuration + 2 ? "warning-text" : "good-text"}>
              {project.script.estimatedDuration > project.brief.targetDuration + 2
                ? "Too many words for the selected duration."
                : "Timing is within working range."}
            </p>
            <div className="line-list">
              {project.script.lines.map((line) => (
                <article className={`script-line ${activeTransportLine?.id === line.id ? "current" : ""}`} key={line.id}>
                  <span>{line.lineNumber}</span>
                  <div>
                    <div className="line-controls">
                      <label>
                        Type
                        <select
                          value={line.type}
                          disabled={project.scriptLocked}
                          onChange={(event) => updateScriptLine(line.id, { type: event.target.value as ScriptLineType })}
                        >
                          {scriptLineTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Voice
                        <select
                          value={line.assignedVoiceRoleId ?? ""}
                          onChange={(event) => updateScriptLine(line.id, { assignedVoiceRoleId: event.target.value || undefined })}
                          disabled={project.scriptLocked || !lineSupportsVoiceRole(line)}
                        >
                          <option value="">Unassigned</option>
                          {project.voiceRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.roleName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="danger-button" onClick={() => deleteScriptLine(line.id)} disabled={project.scriptLocked || project.script.lines.length <= 1}>
                        Delete
                      </button>
                      <button onClick={() => jumpTransportToLine(line.startTime)}>Cue</button>
                    </div>
                    <strong>{line.speaker ?? line.type}</strong>
                    <textarea
                      className="line-textarea"
                      defaultValue={line.text}
                      readOnly={project.scriptLocked}
                      onBlur={(event) => updateScriptLine(line.id, { text: event.target.value })}
                    />
                    <small>{line.startTime.toFixed(1)}-{line.endTime.toFixed(1)}s · {line.emotionalIntent.join(", ")} · {line.performanceNote}</small>
                    <textarea
                      className="line-note"
                      defaultValue={line.performanceNote}
                      readOnly={project.scriptLocked}
                      onBlur={(event) => updateScriptLine(line.id, { performanceNote: event.target.value })}
                    />
                    {line.warnings.map((warning) => (
                      <em key={warning}>{warning}</em>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </section>
      )}

      {activeTab === "Voices" && (
        <section className="studio-grid">
          <Panel title="3. Voice Selection" icon={<Mic size={18} />} detail="Give every character a distinct voice, accent, and performance direction.">
            <div className="upload-row">
              <button className="primary" onClick={addVoiceRole}>
                <Mic size={18} /> Add Voice Role
              </button>
            </div>
            {project.voiceRoles.length === 0 && (
              <p className="large-note">No voice roles yet. Parse a script first — characters are detected automatically.</p>
            )}
            <div className="card-grid">
              {project.voiceRoles.map((role) => {
                const assignedVoice = providerVoices.find((v) => v.voiceId === role.providerVoiceId);
                const linesForRole = project.script.lines.filter((l) => l.assignedVoiceRoleId === role.id);
                return (
                  <article className="voice-card" key={role.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: "0.95rem" }}>{role.roleName}</strong>
                    </div>
                    <small style={{ color: "var(--muted, #6b7280)" }}>
                      {linesForRole.length} line{linesForRole.length !== 1 ? "s" : ""} assigned
                      {linesForRole.length > 0 && ` — "${linesForRole[0].text.slice(0, 48)}${linesForRole[0].text.length > 48 ? "…" : ""}"`}
                    </small>
                    <label>
                      Role name
                      <input
                        value={role.roleName}
                        onChange={(event) => updateVoiceRole(role.id, { roleName: event.target.value })}
                      />
                    </label>
                    <label>
                      Character description
                      <textarea
                        value={role.characterDescription}
                        onChange={(event) => updateVoiceRole(role.id, { characterDescription: event.target.value })}
                      />
                    </label>
                    <div className="voice-fields">
                      <label>
                        Accent
                        <select value={role.accent} onChange={(event) => updateVoiceRole(role.id, { accent: event.target.value })}>
                          {accentOptions.map((accent) => (
                            <option key={accent}>{accent}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Pace
                        <select value={role.pace} onChange={(event) => updateVoiceRole(role.id, { pace: event.target.value as VoiceRole["pace"] })}>
                          <option value="slow">slow</option>
                          <option value="measured">measured</option>
                          <option value="conversational">conversational</option>
                          <option value="quick">quick</option>
                          <option value="fast-read">fast-read</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Performance notes
                      <textarea
                        value={role.performanceNotes}
                        onChange={(event) => updateVoiceRole(role.id, { performanceNotes: event.target.value })}
                      />
                    </label>
                    <label>
                      ElevenLabs voice
                      <select
                        value={role.providerVoiceId ?? ""}
                        onChange={(event) => assignProviderVoiceToRole(role.id, event.target.value)}
                      >
                        <option value="">— unassigned (uses default) —</option>
                        {providerVoices.map((voice) => (
                          <option key={voice.voiceId} value={voice.voiceId}>
                            {voice.name}{voice.labels?.accent ? ` · ${voice.labels.accent}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small style={{ color: "var(--muted, #6b7280)", fontSize: "0.75rem" }}>
                      {role.accent} · {role.provider}{role.providerVoiceId ? ` · ID: ${role.providerVoiceId.slice(0, 12)}…` : ""}
                    </small>
                  </article>
                );
              })}
            </div>
            {autoAssignStatus && (
              <p className="large-note" style={{ marginTop: "0.5rem" }}>{autoAssignStatus}</p>
            )}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <button onClick={() => triggerAutoVoiceAssign()} disabled={isGeneratingVoiceTake}>
                {providerVoices.length === 0 ? "Load & auto-assign voices" : "Re-assign voices"}
              </button>
              <small>
                {providerVoices.length === 0
                  ? "Fetches your ElevenLabs voices and assigns a unique voice to each character"
                  : `${providerVoices.length} voices loaded — each character gets a unique one`}
              </small>
            </div>
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line, #262626)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label>
                ElevenLabs voice model
                <div className="segmented" aria-label="ElevenLabs voice model" style={{ width: "fit-content" }}>
                  <button type="button" className={ttsModel === "eleven_multilingual_v2" ? "active" : ""} onClick={() => setTtsModel("eleven_multilingual_v2")}>
                    v2 · Stable
                  </button>
                  <button type="button" className={ttsModel === "eleven_v3" ? "active" : ""} onClick={() => setTtsModel("eleven_v3")}>
                    v3 · Most expressive
                  </button>
                </div>
              </label>
              <small>
                {ttsModel === "eleven_v3"
                  ? "v3 is ElevenLabs' newest model — more emotional range and delivery, best for performance-heavy lines. Slightly lower per-line character limit (3,000), which won't matter for radio-length lines."
                  : "v2 is the proven, stable model this project has used so far. Switch to v3 to try more expressive delivery on new takes."}
              </small>
              <button className="primary" onClick={generateVoiceTake} disabled={isGeneratingVoiceTake}>
                {isGeneratingVoiceTake ? voiceTakeMessage : "Generate voice takes (all characters)"}
              </button>
              {voiceTakeMessage && <small>{voiceTakeMessage}</small>}
              <button className="primary" onClick={generateFullSpot} disabled={isGeneratingFullSpot}>
                {isGeneratingFullSpot ? fullSpotMessage : "Generate full spot MP3"}
              </button>
              {fullSpotMessage && <small>{fullSpotMessage}</small>}
            </div>
          </Panel>
          <Panel title="4. Recording Takes" icon={<FileAudio size={18} />} detail="Generated voice takes appear here for preview before you commit to a mix.">
            {project.voiceTakes.length === 0 ? <p>No takes yet. Mock provider is ready without credentials.</p> : null}
            {project.voiceTakes.map((take) => (
              <div className="list-row" key={take.id}>
                <strong>Take {take.takeNumber} · {take.provider}{take.isMock ? " mock" : ""}</strong>
                <span>{take.notes}</span>
                {take.audioUrl ? <audio controls src={take.audioUrl} /> : null}
                <small>{take.performanceNotes}</small>
              </div>
            ))}
            {mode === "producer" && (
              <div className="provider-status">
                <div className="provider-status-header">
                  <strong>Provider setup</strong>
                  <button onClick={checkProviderStatus}>Check Providers</button>
                </div>
                <p>{providerStatusMessage}</p>
                <div className="provider-grid">
                  <Metric
                    label="ElevenLabs key"
                    value={providerStatus?.elevenLabs.configured ? "Detected" : "Not detected"}
                  />
                  <Metric
                    label="Default voice"
                    value={providerStatus?.elevenLabs.defaultVoiceIdConfigured ? "Configured" : "Missing"}
                  />
                  <Metric
                    label="Audio routes"
                    value={providerStatus?.elevenLabs.capabilities?.speech ? "Ready" : "Mock only"}
                  />
                  <Metric
                    label="Proxy URL"
                    value={providerProxyBaseUrl.replace("http://", "")}
                  />
                  <Metric
                    label="Claude API configured"
                    value={providerStatus?.claude ? (providerStatus.claude.configured ? "Yes" : "No") : "Unknown"}
                  />
                  <Metric
                    label={`Model "${providerStatus?.claude?.model ?? "claude-sonnet-5"}" reachable`}
                    value={providerStatus?.claude?.configured ? (providerStatus.claude.reachable ? "Yes" : "No") : "Add API key"}
                  />
                </div>
                {providerStatus?.claude && !providerStatus.claude.configured && (
                  <p className="warning-text">
                    ANTHROPIC_API_KEY is not set. Add it to .env, then restart npm run server.
                  </p>
                )}
                {providerStatus?.claude && providerStatus.claude.configured && !providerStatus.claude.reachable && (
                  <p className="warning-text">
                    Can't reach the Claude API. {providerStatus.claude.error ?? "Check ANTHROPIC_API_KEY and your network connection."}
                  </p>
                )}
                <pre className="code-note">
                  Add ELEVENLABS_API_KEY and ELEVENLABS_DEFAULT_VOICE_ID to .env, run npm run server, then check providers here. Keys stay server-side.
                </pre>
              </div>
            )}
          </Panel>
          <Panel title="ElevenLabs Voice Finder" icon={<Sparkles size={18} />} detail="Search the ElevenLabs catalog and map a real voice to each character.">
            <div className="provider-status-header">
              <strong>Voice catalog</strong>
              <button onClick={loadProviderVoices} disabled={isLoadingProviderVoices}>
                {isLoadingProviderVoices ? "Loading..." : "Load voices"}
              </button>
            </div>
            <p>{providerVoicesMessage}</p>
            {voiceSearchBriefs.map((brief) => (
              <div className="list-row" key={brief.roleId}>
                <strong>{brief.roleName}</strong>
                <span>{brief.query}</span>
                <small>{brief.direction}</small>
                <label>
                  Provider voice
                  <select
                    value={project.voiceRoles.find((role) => role.id === brief.roleId)?.providerVoiceId ?? ""}
                    onChange={(event) => assignProviderVoiceToRole(brief.roleId, event.target.value)}
                    disabled={providerVoices.length === 0}
                  >
                    <option value="">Use default / unassigned</option>
                    {providerVoices.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.name} · {voice.source}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
            <pre className="code-note">
              With an ElevenLabs key, this loads real provider voices through the server proxy. Without a key, it loads mock casting references so the demo workflow still works.
            </pre>
          </Panel>
          <Panel title="VO Voice Transformer" icon={<Mic size={18} />} detail="Turn an approved recording into a different target voice, with consent required.">
            <p className="large-note">
              Use an approved VO source recording as the performance base, then transform it into a target ElevenLabs voice while keeping keys server-side.
            </p>
            <label>
              Target role
              <select value={voiceTransformTargetRoleId} onChange={(event) => setVoiceTransformTargetRoleId(event.target.value)}>
                {project.voiceRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.roleName}{role.providerVoiceId ? "" : " (default provider voice)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="file-button">
              {voiceSourceFile ? voiceSourceFile.name : "Upload VO source audio"}
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
                onChange={(event) => setVoiceSourceFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="consent-row">
              <input type="checkbox" checked={voiceTransformConsent} onChange={(event) => setVoiceTransformConsent(event.target.checked)} />
              I have VO consent and rights to transform this recording for this project.
            </label>
            <div className="tool-stack">
              <button className="primary" onClick={transformVoVoice}>Transform VO preview</button>
              <button onClick={checkProviderStatus}>Check ElevenLabs</button>
            </div>
            <small>{voiceTransformMessage}</small>
            {voiceTransformAudioUrl ? <audio controls src={voiceTransformAudioUrl} /> : null}
          </Panel>

          <Panel title="5. Full Mix Preview (Voices + SFX + Music)" icon={<FileAudio size={18} />} detail="A quick full-mix render so you can hear how voices, SFX, and music sit together.">
            <p className="large-note">
              Render and preview a complete multi-track mix combining your generated voice takes, sound effects (SFX), and music bed using your current mix engineer balance levels.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button 
                  className="primary" 
                  onClick={renderFullMixedAudio} 
                  disabled={isRenderingMix || isGeneratingAllAndMixing}
                >
                  {isRenderingMix ? "Rendering Full Mix..." : "Generate Full Mixed Preview"}
                </button>
                <button
                  className="primary"
                  onClick={generateAllAudioAndMix}
                  disabled={isGeneratingAllAndMixing || isRenderingMix}
                >
                  {isGeneratingAllAndMixing ? "Generating & Mixing..." : "Auto-Generate All & Mix"}
                </button>
              </div>
              {generateAllAndMixMessage && <small style={{ fontWeight: "bold", color: "var(--accent-2, #b7c2b0)" }}>{generateAllAndMixMessage}</small>}
              {mixRenderingMessage && <small style={{ fontWeight: "bold" }}>{mixRenderingMessage}</small>}
              {mixedAudioUrl && (
                <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <audio controls src={mixedAudioUrl} style={{ width: "100%" }} />
                  <button onClick={downloadMixedAudio}>Download Full Mix (.MP3)</button>
                </div>
              )}
            </div>
          </Panel>
        </section>
      )}

      {activeTab === "Sound Design" && (
        <section className="studio-grid">
          <Panel title="5. SFX Library & Sound Design" icon={<Sparkles size={18} />} detail="Design sound effect and music cues, then generate the audio for each one.">

            <Metric label="Location" value="Scripted world" />
            <Metric label="Texture" value="Natural, restrained, mnemonic-led" />
            <Metric label="Sound design feedback" value={soundDesignMessage || "Design and generate audio layers."} />
            <div className="tool-stack">
              <button className="primary" onClick={autoGenerateSoundCues}>Auto-detect & Rebuild Cues</button>
              <button onClick={() => setCommandDraft("Add a distinctive opening sound hook")}>SFX hook</button>
              <button onClick={() => setCommandDraft("Make the music more cinematic but keep the voice clear")}>Music bed</button>
              <button onClick={() => setCommandDraft("Create a clean final brand sting")}>Brand sting</button>
            </div>

            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line, #262626)", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <label>
                ElevenLabs sound effects model
                <div className="segmented" aria-label="ElevenLabs sound effects model" style={{ width: "fit-content" }}>
                  <button type="button" className={sfxModel === "eleven_text_to_sound_v2" ? "active" : ""} onClick={() => setSfxModel("eleven_text_to_sound_v2")}>
                    v2 · Sound Effects
                  </button>
                </div>
              </label>
              <small>
                ElevenLabs currently ships one Sound Effects model (v2). There is no v3 for sound effects yet — v3 is a separate, speech-only model used in the Voices tab. When ElevenLabs releases a newer sound-effects model, it will appear here as a real, working option.
              </small>
              <label>
                ElevenLabs music model
                <div className="segmented" aria-label="ElevenLabs music model" style={{ width: "fit-content" }}>
                  <button type="button" className={musicModel === "music_v1" ? "active" : ""} onClick={() => setMusicModel("music_v1")}>
                    v1 · Stable
                  </button>
                  <button type="button" className={musicModel === "music_v2" ? "active" : ""} onClick={() => setMusicModel("music_v2")}>
                    v2 · Studio-grade
                  </button>
                </div>
              </label>
              <small>
                {musicModel === "music_v2"
                  ? "v2 is ElevenLabs' newer flagship music model — better prompt adherence, section-by-section composition, mid-track genre transitions, and sound effects embedded directly in the track."
                  : "v1 is the original, stable music model this project has used so far. Switch to v2 for richer composition on new tracks."}
              </small>
            </div>

            <div style={{ marginTop: "1.5rem", borderBottom: "1px solid var(--line, #262626)", paddingBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "bold" }}>Sound Effects (SFX) Cues</h3>
                <button className="primary" onClick={addSoundCue}>+ Add Sound Cue</button>
              </div>
              {project.soundCues.length === 0 ? (
                <p className="large-note">No sound cues defined. Click "+ Add Sound Cue" to design a sound effect.</p>
              ) : (
                <div className="card-grid">
                  {project.soundCues.map((cue) => (
                    <article className="voice-card" key={cue.id} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: "0.95rem" }}>{cue.label}</strong>
                        <button className="danger-button" onClick={() => deleteSoundCue(cue.id)}>Delete</button>
                      </div>
                      <label>
                        Label
                        <input
                          value={cue.label}
                          onChange={(e) => updateSoundCue(cue.id, { label: e.target.value })}
                        />
                      </label>
                      <label>
                        SFX Prompt (for AI generation)
                        <textarea
                          value={cue.sfxMoment}
                          onChange={(e) => updateSoundCue(cue.id, { sfxMoment: e.target.value })}
                          placeholder="Describe the sound effect in detail (e.g. wind chimes blowing in breeze)"
                        />
                      </label>
                      <div className="voice-fields">
                        <label>
                          Start Time (s)
                          <input
                            type="number"
                            step="0.1"
                            value={cue.startTime}
                            onChange={(e) => updateSoundCue(cue.id, { startTime: parseFloat(e.target.value) || 0 })}
                          />
                        </label>
                        <label>
                          End Time (s)
                          <input
                            type="number"
                            step="0.1"
                            value={cue.endTime}
                            onChange={(e) => updateSoundCue(cue.id, { endTime: parseFloat(e.target.value) || 0 })}
                          />
                        </label>
                      </div>
                      <label>
                        Texture notes
                        <input
                          value={cue.texture}
                          onChange={(e) => updateSoundCue(cue.id, { texture: e.target.value })}
                        />
                      </label>
                      <label>
                        Production notes
                        <textarea
                          value={cue.notes}
                          onChange={(e) => updateSoundCue(cue.id, { notes: e.target.value })}
                        />
                      </label>

                      <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <button
                          className="primary"
                          onClick={() => generateSoundCueAudio(cue.id)}
                          disabled={generatingSfxCueId === cue.id}
                        >
                          {generatingSfxCueId === cue.id ? "Generating SFX..." : "Generate AI SFX"}
                        </button>
                        {cue.audioUrl ? (
                          <audio controls src={cue.audioUrl} style={{ width: "100%" }} />
                        ) : (
                          <small style={{ color: "var(--muted, #6b7280)", fontSize: "0.75rem" }}>No audio generated yet.</small>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "bold" }}>Music Cues</h3>
                <button className="primary" onClick={addMusicCue}>+ Add Music Cue</button>
              </div>
              {project.musicCues.length === 0 ? (
                <p className="large-note">No music cues defined. Click "+ Add Music Cue" to compose music.</p>
              ) : (
                <div className="card-grid">
                  {project.musicCues.map((cue) => (
                    <article className="voice-card" key={cue.id} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: "0.95rem" }}>{cue.label}</strong>
                        <button className="danger-button" onClick={() => deleteMusicCue(cue.id)}>Delete</button>
                      </div>
                      <label>
                        Label
                        <input
                          value={cue.label}
                          onChange={(e) => updateMusicCue(cue.id, { label: e.target.value })}
                        />
                      </label>
                      <label>
                        Music Style (e.g. warm piano, corporate synth pulse)
                        <input
                          value={cue.style}
                          onChange={(e) => updateMusicCue(cue.id, { style: e.target.value })}
                        />
                      </label>
                      <div className="voice-fields">
                        <label>
                          Mood
                          <input
                            value={cue.mood}
                            onChange={(e) => updateMusicCue(cue.id, { mood: e.target.value })}
                          />
                        </label>
                        <label>
                          Tempo
                          <input
                            value={cue.tempo}
                            onChange={(e) => updateMusicCue(cue.id, { tempo: e.target.value })}
                          />
                        </label>
                      </div>
                      <label>
                        Instrumentation
                        <input
                          value={cue.instrumentation}
                          onChange={(e) => updateMusicCue(cue.id, { instrumentation: e.target.value })}
                        />
                      </label>
                      <div className="voice-fields">
                        <label>
                          Start Time (s)
                          <input
                            type="number"
                            step="0.1"
                            value={cue.startTime}
                            onChange={(e) => updateMusicCue(cue.id, { startTime: parseFloat(e.target.value) || 0 })}
                          />
                        </label>
                        <label>
                          End Time (s)
                          <input
                            type="number"
                            step="0.1"
                            value={cue.endTime}
                            onChange={(e) => updateMusicCue(cue.id, { endTime: parseFloat(e.target.value) || 0 })}
                          />
                        </label>
                      </div>
                      <label>
                        Production notes
                        <textarea
                          value={cue.notes}
                          onChange={(e) => updateMusicCue(cue.id, { notes: e.target.value })}
                        />
                      </label>

                      <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <button
                          className="primary"
                          onClick={() => generateMusicCueAudio(cue.id)}
                          disabled={generatingMusicCueId === cue.id}
                        >
                          {generatingMusicCueId === cue.id ? "Composing music..." : "Generate AI Music"}
                        </button>
                        {cue.audioUrl ? (
                          <audio controls src={cue.audioUrl} style={{ width: "100%" }} />
                        ) : (
                          <small style={{ color: "var(--muted, #6b7280)", fontSize: "0.75rem" }}>No audio generated yet.</small>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Production Timeline" icon={<SlidersHorizontal size={18} />} detail="Every voice, SFX, and music block laid out across the ad's runtime.">

            <Metric label="Score length" value={`${productionPrompts.durationSeconds}s`} />
            <div className="list-row">
              <strong>Music generation brief</strong>
              <span>{productionPrompts.musicPrompt}</span>
            </div>
            <div className="timeline">
              {project.timeline.map((block) => (
                <div
                  className={`timeline-block ${block.warningStatus ?? "ok"}`}
                  key={block.id}
                  style={{
                    left: `${Math.min(96, (block.start / project.brief.targetDuration) * 100)}%`,
                    width: `${Math.max(4, ((block.end - block.start) / project.brief.targetDuration) * 100)}%`,
                  }}
                  title={`${block.label}: ${block.notes}`}
                >
                  {block.label}
                </div>
              ))}
            </div>
            <small>0.0s to {project.brief.targetDuration}.0s</small>
          </Panel>

          <Panel title="6. Full Mix Preview (Voices + SFX + Music)" icon={<FileAudio size={18} />} detail="A quick full-mix render so you can hear how voices, SFX, and music sit together.">

            <p className="large-note">
              Render and preview a complete multi-track mix combining your generated voice takes, sound effects (SFX), and music bed using your current mix engineer balance levels.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button 
                  className="primary" 
                  onClick={renderFullMixedAudio} 
                  disabled={isRenderingMix || isGeneratingAllAndMixing}
                >
                  {isRenderingMix ? "Rendering Full Mix..." : "Generate Full Mixed Preview"}
                </button>
                <button
                  className="primary"
                  onClick={generateAllAudioAndMix}
                  disabled={isGeneratingAllAndMixing || isRenderingMix}
                >
                  {isGeneratingAllAndMixing ? "Generating & Mixing..." : "Auto-Generate All & Mix"}
                </button>
              </div>
              {generateAllAndMixMessage && <small style={{ fontWeight: "bold", color: "var(--accent-2, #b7c2b0)" }}>{generateAllAndMixMessage}</small>}
              {mixRenderingMessage && <small style={{ fontWeight: "bold" }}>{mixRenderingMessage}</small>}
              {mixedAudioUrl && (
                <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <audio controls src={mixedAudioUrl} style={{ width: "100%" }} />
                  <button onClick={downloadMixedAudio}>Download Full Mix (.MP3)</button>
                </div>
              )}
            </div>
          </Panel>

        </section>
      )}


      {activeTab === "Mix" && (
        <>
          <section className="panel">
            <SectionHeader title="7. Mix Engineer" detail="Balance voice, music, SFX, space, and final production intent before station formatting." />
            <div className="tool-stack">
              <button className="primary" onClick={applyAutoMix}>Apply auto-mix baseline</button>
              <button onClick={() => setCommandDraft("Make the mix voice-led and keep legal clear")}>Voice-led mix note</button>
            </div>
            <div className="readiness-list">
              <Metric label="Loudness target" value={project.mixSettings.loudnessTarget} />
              <Metric label="True peak target" value={project.mixSettings.truePeakTarget} />
              <Metric label="Studio knowledge matches" value={String(audioQualityHits.length)} />
            </div>
            <div className="slider-grid">
              {[
                ["voiceLevel", "Voice level"],
                ["musicLevel", "Music level"],
                ["sfxLevel", "SFX level"],
                ["compressionIntensity", "Compression"],
                ["brightness", "Brightness"],
                ["warmth", "Warmth"],
                ["roomSpace", "Room / space"],
                ["deEssing", "De-essing"],
                ["noiseBed", "Noise bed"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="range"
                    min={key.includes("Level") ? -30 : 0}
                    max={key.includes("Level") ? 0 : 100}
                    value={Number(project.mixSettings[key as keyof typeof project.mixSettings])}
                    onChange={(event) =>
                      setProject((p) =>
                        recomputeProject(
                          { ...p, mixSettings: { ...p.mixSettings, [key]: Number(event.target.value) } },
                          `Mix updated: ${label}`,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <div className="rag-guidance">
              <div className="section-header compact">
                <div>
                  <h2>Studio knowledge: mix &amp; mastering</h2>
                  <p>Mix, mastering, loudness, music, and SFX guidance retrieved from the imported audio knowledge pack.</p>
                </div>
              </div>
              {audioQualityHits.map((hit) => (
                <div className="list-row" key={hit.item.id}>
                  <strong>{hit.item.title}</strong>
                  <span>{hit.item.guidance[0]}</span>
                  <small>{hit.reason}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="panel" style={{ marginTop: "1rem" }}>
            <SectionHeader title="Full Mix Preview" detail="Combine voice takes, SFX, and music bed into a single mixed MP3 preview." />
            <p className="large-note">
              Render and preview a complete multi-track mix combining your generated voice takes, sound effects (SFX), and music bed using your current mix engineer balance levels.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button 
                  className="primary" 
                  onClick={renderFullMixedAudio} 
                  disabled={isRenderingMix || isGeneratingAllAndMixing}
                >
                  {isRenderingMix ? "Rendering Full Mix..." : "Generate Full Mixed Preview"}
                </button>
                <button
                  className="primary"
                  onClick={generateAllAudioAndMix}
                  disabled={isGeneratingAllAndMixing || isRenderingMix}
                >
                  {isGeneratingAllAndMixing ? "Generating & Mixing..." : "Auto-Generate All & Mix"}
                </button>
              </div>
              {generateAllAndMixMessage && <small style={{ fontWeight: "bold", color: "var(--accent-2, #b7c2b0)" }}>{generateAllAndMixMessage}</small>}
              {mixRenderingMessage && <small style={{ fontWeight: "bold" }}>{mixRenderingMessage}</small>}
              {mixedAudioUrl && (
                <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <audio controls src={mixedAudioUrl} style={{ width: "100%" }} />
                  <button onClick={downloadMixedAudio}>Download Full Mix (.MP3)</button>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {activeTab === "Compliance" && (
        <section className="studio-grid">
          <Panel
            title="QC Results"
            icon={<ShieldCheck size={18} />}
            detail="Automated checks only — a human still needs to sign off before broadcast."
          >
            <div className="readiness-list">
              <Metric label="Passing" value={String(project.qcResults.filter((item) => item.status === "pass").length)} />
              <Metric label="Warnings" value={String(qcWarnCount)} />
              <Metric label="Failures" value={String(qcFailCount)} />
            </div>
            {project.qcResults.length === 0 ? (
              <p className="large-note">No QC checks have run yet. Parse a script and generate audio to populate results.</p>
            ) : (
              <div className="qc-list">
                {project.qcResults.map((result) => (
                  <div className={`qc-row ${result.status}`} key={result.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                      <strong>{result.check}</strong>
                      <span>{result.status}</span>
                    </div>
                    <p style={{ margin: "0.2rem 0" }}>{result.explanation}</p>
                    <small>Fix: {result.recommendedFix} · Confidence: {result.confidence}</small>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Download the QC report" icon={<Download size={18} />} detail="A markdown copy of this exact report, for the client or the station.">
            <button className="primary" onClick={() => exportDocument("qc")}>
              <Download size={16} /> Download qc-report.md
            </button>
          </Panel>
        </section>
      )}

      {activeTab === "Export" && (
        <section className="studio-grid">
          <Panel
            title="Download Package"
            icon={<Download size={18} />}
            detail="Each file is generated from your current project — re-download any time something changes."
          >
            <div className="list-row">
              <strong>Script (Markdown)</strong>
              <span>Numbered, timed script with performance notes for the studio or client.</span>
              <div className="tool-stack">
                <button className="primary" onClick={() => exportDocument("script")}>
                  <Download size={16} /> Download script.md
                </button>
              </div>
            </div>
            <div className="list-row">
              <strong>Cue sheet (Markdown)</strong>
              <span>Voice, SFX, and music timing in one reference sheet for the engineer.</span>
              <div className="tool-stack">
                <button className="primary" onClick={() => exportDocument("cue-sheet")}>
                  <Download size={16} /> Download cue-sheet.md
                </button>
              </div>
            </div>
            <div className="list-row">
              <strong>QC report (Markdown)</strong>
              <span>All automated QC checks with explanations and recommended fixes.</span>
              <div className="tool-stack">
                <button className="primary" onClick={() => exportDocument("qc")}>
                  <Download size={16} /> Download qc-report.md
                </button>
              </div>
            </div>
            <div className="list-row">
              <strong>Craft quality (Markdown)</strong>
              <span>Overall score, sub-scores, and the next best craft move.</span>
              <div className="tool-stack">
                <button className="primary" onClick={() => exportDocument("craft")}>
                  <Download size={16} /> Download craft-quality.md
                </button>
              </div>
            </div>
            <div className="list-row">
              <strong>Production notes (Markdown)</strong>
              <span>Tone, audience, approval status, voice roles, and rights records.</span>
              <div className="tool-stack">
                <button className="primary" onClick={() => exportDocument("notes")}>
                  <Download size={16} /> Download production-notes.md
                </button>
              </div>
            </div>
            <div className="list-row">
              <strong>Full project (JSON)</strong>
              <span>The complete project file — re-import it later with "Import JSON" to keep working.</span>
              <div className="tool-stack">
                <button onClick={() => exportDocument("json")}>
                  <Download size={16} /> Download project.json
                </button>
              </div>
            </div>
          </Panel>
        </section>
      )}

      {activeTab === "Memory" && (
        <section className="studio-grid">
          <Panel title="Studio Memory" icon={<Sparkles size={18} />} detail="Craft principles the studio has learned and applies to every project.">
            {project.craftMemory.map((item) => (
              <article className="memory-card" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.principle}</p>
                <small>{item.example}</small>
              </article>
            ))}
          </Panel>
          <Panel title="Studio Knowledge" icon={<Radio size={18} />} detail="Guidance retrieved from the knowledge base that's relevant to this specific project.">
            {knowledgeHits.length === 0 ? <p>No matching knowledge found for this project yet.</p> : null}
            {knowledgeHits.map((hit) => (
              <article className="memory-card" key={hit.item.id}>
                <h3>{hit.item.title}</h3>
                <p>{hit.item.summary}</p>
                <small>{hit.reason} Source: {hit.item.source}.</small>
                <ul>
                  {hit.item.guidance.slice(0, 3).map((guidance) => (
                    <li key={guidance}>{guidance}</li>
                  ))}
                </ul>
              </article>
            ))}
          </Panel>
          <Panel title="Command Log" icon={<Wand2 size={18} />} detail="Every direction you've given the Audio Director, and whether it was applied.">

            {project.commandLog.length === 0 ? <p>No commands proposed yet.</p> : null}
            {project.commandLog.map((command) => (
              <div className="list-row" key={command.id}>
                <strong>{command.rawCommand}</strong>
                <span>{command.intent}: {command.proposedChange}</span>
                <small>Status: {command.status}</small>
                {command.status === "proposed" ? (
                  <div className="inline-actions">
                    <button onClick={() => applyCommand(command.id)}>Apply</button>
                    <button onClick={() => updateCommandStatus(command.id, "rejected")}>Reject</button>
                  </div>
                ) : null}
              </div>
            ))}
          </Panel>
        </section>
      )}
          </main>

          {showProductionToolbar && (
            <aside className="ai-director-panel">
              <div className="ai-director-header">
                <Wand2 size={18} />
                <div>
                  <strong>AI Director</strong>
                  <span>{voiceCommandStatus}</span>
                </div>
              </div>

              {lastVoiceTranscript ? <small className="ai-director-heard">Last heard: “{lastVoiceTranscript}”</small> : null}

              <div className="ai-director-suggestions">
                {proposedCommands.length === 0 ? (
                  <p className="large-note">No open suggestions. Type a direction below and the director will propose a change.</p>
                ) : (
                  proposedCommands.map((command) => (
                    <div className="suggestion-card" key={command.id}>
                      <strong>{command.intent === "unknown" ? "Producer note" : command.intent.replace(/-/g, " ")}</strong>
                      <p>{command.proposedChange}</p>
                      <small>{command.affectedLineIds.length ? `${command.affectedLineIds.length} line(s) affected.` : "No specific line targeted."}</small>
                      <div className="suggestion-actions">
                        <button className="primary" onClick={() => applyCommand(command.id)}>Apply</button>
                        <button onClick={() => updateCommandStatus(command.id, "rejected")}>Ignore</button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="ai-director-input">
                <input
                  value={commandDraft}
                  onChange={(event) => setCommandDraft(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && addCommand()}
                  placeholder="Ask AI Director anything..."
                />
                <button title="Talk to Audio Director" className={isListening ? "active" : ""} onClick={startVoiceCommand}>
                  <Mic size={16} />
                </button>
                <button className="primary" onClick={addCommand}>Propose</button>
              </div>
            </aside>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

// Custom waveform scrubber for the sidebar Preview player (redesign guide,
// "Advanced Effects" — canvas waveform). There's no decoded PCM to analyze
// for an arbitrary in-progress project, so the bar heights are a stylized,
// deterministic reading of the script structure (voice lines read taller,
// SFX/music read medium, pauses read flat) rather than a literal amplitude
// trace — still a real waveform-style scrubber, just script-driven instead
// of audio-driven.
function WaveformScrubber({
  duration,
  currentTime,
  lines,
  theme,
  onSeek,
}: {
  duration: number;
  currentTime: number;
  lines: Project["script"]["lines"];
  theme: "dark" | "light";
  onSeek: (time: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const bars = useMemo(() => {
    const barCount = 56;
    return Array.from({ length: barCount }, (_, index) => {
      const t = (index / barCount) * duration;
      const line = lines.find((candidate) => t >= candidate.startTime && t <= candidate.endTime);
      const seed = Math.sin(index * 12.9898) * 43758.5453;
      const noise = seed - Math.floor(seed);
      let base = 0.28;
      if (line) {
        if (line.type === "sound-effect") base = 0.45;
        else if (line.type === "music") base = 0.58;
        else if (line.type === "pause" || line.type === "note") base = 0.14;
        else base = 0.6;
      }
      return Math.max(0.08, Math.min(1, base + (noise - 0.5) * 0.5));
    });
  }, [duration, lines]);

  useEffect(() => {
     const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const playedColor = styles.getPropertyValue("--accent-2").trim() || "#b7c2b0";
    const mutedColor = styles.getPropertyValue("--line-strong").trim() || "rgba(255,255,255,0.28)";

    const gap = 2;
    const barWidth = Math.max(1, (width - gap * (bars.length - 1)) / bars.length);
    const playedRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;
    const playedX = playedRatio * width;

    bars.forEach((value, index) => {
      const x = index * (barWidth + gap);
      const barHeight = Math.max(2, value * height);
      const y = (height - barHeight) / 2;
      ctx.fillStyle = x < playedX ? playedColor : mutedColor;
      ctx.fillRect(x, y, barWidth, barHeight);
    });

    ctx.fillStyle = playedColor;
    ctx.fillRect(Math.max(0, Math.min(width - 2, playedX - 1)), 0, 2, height);
  }, [bars, currentTime, duration, theme]);

  const seekFromClientX = (clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(rect.width, 1);
    onSeek(Math.max(0, Math.min(duration, ratio * duration)));
  };

  return (
    <div
      ref={containerRef}
      className="waveform-scrubber"
      role="slider"
      aria-label="Jump along ad timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") onSeek(Math.min(duration, currentTime + 1));
        if (event.key === "ArrowLeft") onSeek(Math.max(0, currentTime - 1));
      }}
      onMouseDown={(event) => {
        setIsDragging(true);
        seekFromClientX(event.clientX);
      }}
      onMouseMove={(event) => {
        if (isDragging) seekFromClientX(event.clientX);
      }}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

// Ambient, cursor-reactive particle field — the "napkin.ie signature" effect
// from the redesign guide's Advanced Effects section. Implemented with plain
// Canvas 2D rather than a WebGL/Three.js dependency: same restrained visual
// (a faint drifting field of dots that nudge away from the cursor), without
// adding a ~600KB dependency for what is, by design, a very subtle background
// detail. Respects prefers-reduced-motion by not animating at all.
function ParticleField({ theme }: { theme: "dark" | "light" }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const particleCount = Math.min(60, Math.max(20, Math.round((width * height) / 24000)));
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.1,
      r: Math.random() * 1.3 + 0.5,
    }));

    const pointer = { x: width / 2, y: height / 2, active: false };
    const handlePointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    };
    window.addEventListener("pointermove", handlePointerMove);

    const dotColor = getComputedStyle(document.documentElement).getPropertyValue("--accent-2").trim() || "#b7c2b0";

    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = dotColor;
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };

    if (reduceMotion) {
      drawStatic();
      return () => window.removeEventListener("resize", resize);
    }

    let raf = 0;
    const step = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = dotColor;
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 140 && dist > 0.001) {
            const force = ((140 - dist) / 140) * 0.02;
            p.x += (dx / dist) * force;
            p.y += (dy / dist) * force;
          }
        }
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [theme]);

  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />;
}

function Panel({
  title,
  icon,
  detail,
  children,
  style,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  detail?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <section className={`panel ${className || ""}`} style={style}>
      <SectionHeader title={title} icon={icon} detail={detail} />
      {children}
    </section>
  );
}

function SectionHeader({ title, detail, icon }: { title: string; detail?: string; icon?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <h2>{icon} {title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="floating-field">
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder=" " />
      <label htmlFor={id} className="floating-label">
        {label}
      </label>
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="floating-field floating-field-area">
      <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder=" " />
      <label htmlFor={id} className="floating-label">
        {label}
      </label>
    </div>
  );
}
