import {
  CheckCircle2,
  Download,
  FileAudio,
  Mic,
  Radio,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parseCommand, ScriptDoctorAgent } from "./agents/studioAgents";
import { createProject, recomputeProject, updateScriptFromText } from "./data/sampleProject";
import { exportPresets, stationSpecs } from "./data/stationSpecs";
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
import { assignLineTimings, estimateLineDuration, totalDuration, wordsPerSecond } from "./lib/timing";
import { MockVoiceProvider } from "./services/voiceProviders";
import type { ApprovalStatus, Brief, Project, ScriptLineType } from "./types/models";

const tabs = ["Home", "Brief", "Script", "Voices", "Sound", "Mix", "Craft Quality", "Export", "Craft Memory"] as const;
type Tab = (typeof tabs)[number];

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
const approvalStatuses: ApprovalStatus[] = [
  "Draft",
  "Internal review",
  "Client review",
  "Approved for production",
  "Approved for broadcast",
  "Exported",
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

const storageKey = "ra-studio-current-project";

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
  return {
    ...fallback,
    ...candidate,
    brief: { ...fallback.brief, ...candidate.brief },
    script: { ...fallback.script, ...candidate.script, lines: candidate.script?.lines ?? fallback.script.lines },
    voiceRoles: candidate.voiceRoles ?? fallback.voiceRoles,
    voiceTakes: candidate.voiceTakes ?? fallback.voiceTakes,
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
};

const loadInitialProject = () => {
  if (typeof window === "undefined") return createProject();
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return createProject();
  try {
    const parsed = JSON.parse(saved);
    if (isProjectLike(parsed)) return recomputeProject(normalizeProject(parsed), "Loaded saved browser project");
  } catch {
    window.localStorage.removeItem(storageKey);
  }
  return createProject();
};

export function App() {
  const [project, setProject] = useState<Project>(() => loadInitialProject());
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [mode, setMode] = useState<"creative" | "producer">("creative");
  const [scriptDraft, setScriptDraft] = useState(project.script.rawText);
  const [commandDraft, setCommandDraft] = useState("");
  const selectedStation = stationSpecs.find((station) => station.id === project.stationSpecId) ?? stationSpecs[0];
  const preset = exportPresets.find((item) => item.id === project.exportPresetId) ?? exportPresets[0];
  const craftActions = useMemo(() => ScriptDoctorAgent.actions(project), [project]);

  useEffect(() => {
    setScriptDraft(project.script.rawText);
  }, [project.script.rawText]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(project));
    } catch {
      // Local persistence is a convenience only; export JSON remains the durable backup.
    }
  }, [project]);

  const handleScriptUpload = async (file?: File) => {
    if (!file) return;
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
        alert("That JSON does not look like an RA Studio project package.");
        return;
      }
      const importedProject = recomputeProject(normalizeProject(parsed), `Imported project JSON: ${file.name}`);
      setProject(importedProject);
      setActiveTab("Home");
    } catch {
      alert("Could not read that project JSON.");
    }
  };

  const addCommand = () => {
    if (!commandDraft.trim()) return;
    const intent = parseCommand(commandDraft, project);
    setProject((current) => ({ ...current, commandLog: [intent, ...current.commandLog], updatedAt: new Date().toISOString() }));
    setCommandDraft("");
  };

  const startNewProject = () => {
    if (!window.confirm("Start a new RA Studio project and replace the browser autosave? Export JSON first if you need the current work.")) {
      return;
    }
    window.localStorage.removeItem(storageKey);
    const freshProject = createProject();
    setProject(freshProject);
    setScriptDraft(freshProject.script.rawText);
    setActiveTab("Home");
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
      const commandLog = current.commandLog.map((item) => (item.id === commandId ? { ...item, status: "applied" as const } : item));
      const targetLines = command.affectedLineIds.length
        ? command.affectedLineIds
        : current.script.lines.filter((line) => !["music", "sound-effect", "pause", "note"].includes(line.type)).map((line) => line.id);

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
      const currentLine = current.script.lines.find((line) => line.id === lineId);
      if (!currentLine) return current;
      const hasChange = Object.entries(updates).some(([key, value]) => currentLine[key as keyof typeof currentLine] !== value);
      if (!hasChange) return current;
      const updatedLines = current.script.lines.map((line) => {
        if (line.id !== lineId) return line;
        const updatedLine = { ...line, ...updates };
        if (updates.text !== undefined || updates.type !== undefined) {
          return {
            ...updatedLine,
            estimatedDuration: estimateLineDuration(updatedLine.text, updatedLine.type === "legal"),
          };
        }
        return updatedLine;
      });
      const script = retimeScript({
        ...current.script,
        rawText: rawTextFromLines(updatedLines),
        lines: updatedLines,
      });
      return recomputeProject({ ...current, script, soundCues: [] }, `Line ${currentLine.lineNumber} edited`);
    });
  };

  const addScriptLine = () => {
    setProject((current) => {
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
      if (current.script.lines.length <= 1) return current;
      const line = current.script.lines.find((item) => item.id === lineId);
      const lines = current.script.lines.filter((item) => item.id !== lineId);
      const script = retimeScript({ ...current.script, rawText: rawTextFromLines(lines), lines });
      return recomputeProject({ ...current, script, soundCues: [] }, `Line ${line?.lineNumber ?? ""} deleted`);
    });
  };

  const startVoiceCommand = () => {
    type SpeechRecognitionCtor = new () => {
      lang: string;
      start: () => void;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
      onerror: (() => void) | null;
    };
    const browserWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      alert("Browser speech recognition is not available here. Typed commands still work.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-IE";
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setCommandDraft(transcript);
    };
    recognition.onerror = () => alert("Voice command capture failed. Try typing the command.");
    recognition.start();
  };

  const generateMockTake = async () => {
    const provider = new MockVoiceProvider();
    const firstLine = project.script.lines.find((line) => line.assignedVoiceRoleId);
    if (!firstLine?.assignedVoiceRoleId) return;
    const take = await provider.generateTake({
      roleId: firstLine.assignedVoiceRoleId,
      lineId: firstLine.id,
      text: firstLine.text,
      performanceNotes: firstLine.performanceNote,
      takeNumber: project.voiceTakes.length + 1,
    });
    setProject((current) => recomputeProject({ ...current, voiceTakes: [take, ...current.voiceTakes] }, "Mock voice take generated"));
  };

  const exportName = project.brief.brand.replace(/\W+/g, "-").toLowerCase() || "ra-studio";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">RA Studio</p>
          <h1>{project.brief.projectName}</h1>
          <p className="subhead">
            AI radio craft studio for script, performance, sound design, QC, and export discipline.
          </p>
        </div>
        <div className="topbar-actions">
          <div className="segmented" aria-label="Mode">
            <button className={mode === "creative" ? "active" : ""} onClick={() => setMode("creative")}>
              Creative
            </button>
            <button className={mode === "producer" ? "active" : ""} onClick={() => setMode("producer")}>
              Producer
            </button>
          </div>
          <button className="primary" onClick={() => setActiveTab("Script")}>
            <FileAudio size={18} /> Open Studio
          </button>
          <button onClick={startNewProject}>New Project</button>
          <label className="file-button">
            Import JSON
            <input type="file" accept="application/json,.json" onChange={(event) => handleProjectImport(event.target.files?.[0])} />
          </label>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      <section className="command-bar">
        <Wand2 size={18} />
        <input
          value={commandDraft}
          onChange={(event) => setCommandDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addCommand()}
          placeholder="Try: Make the ending land, slow down the legal line, add a softer Dublin voice..."
        />
        <button title="Capture voice command" onClick={startVoiceCommand}>
          <Mic size={18} />
        </button>
        <button onClick={addCommand}>Propose</button>
      </section>

      {activeTab === "Home" && (
        <section className="studio-grid home-grid">
          <div className="hero-panel">
            <div className="hero-copy">
              <p className="eyebrow">Current project</p>
              <h2>{project.brief.brand || "Untitled brand"}</h2>
              <p>{project.brief.campaign}</p>
            </div>
            <div className="score-orb">
              <span>{project.craftQuality.overallScore}</span>
              <small>{project.craftQuality.scoreBand}</small>
            </div>
          </div>
          <Metric label="Duration" value={`${project.script.estimatedDuration}s / ${project.brief.targetDuration}s`} />
          <Metric label="Status" value={project.approvalStatus} />
          <Metric label="Export readiness" value={project.qcResults.some((item) => item.status === "fail") ? "Needs fixes" : "Package shaping"} />
          <Panel title="Recent Versions" icon={<CheckCircle2 size={18} />}>
            {project.versionHistory.slice(-5).reverse().map((version) => (
              <div className="list-row" key={version.id}>
                <strong>{version.label}</strong>
                <span>{version.summary}</span>
              </div>
            ))}
          </Panel>
          <Panel title="Next Craft Move" icon={<Sparkles size={18} />}>
            <p className="large-note">{project.craftQuality.nextBestCraftMove}</p>
            <button className="primary" onClick={() => setActiveTab("Craft Quality")}>
              Improve craft
            </button>
          </Panel>
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
          <Panel title="Script Editor" icon={<Upload size={18} />}>
            <div className="upload-row">
              <label className="file-button">
                Upload .txt / .md
                <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => handleScriptUpload(event.target.files?.[0])} />
              </label>
              <button className="primary" onClick={() => setProject((p) => updateScriptFromText(p, scriptDraft))}>
                Parse script
              </button>
              <button onClick={addScriptLine}>Add Line</button>
            </div>
            <textarea className="script-input" value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)} />
          </Panel>
          <Panel title="Timing & Parse" icon={<Radio size={18} />}>
            <Metric label="Estimated runtime" value={`${project.script.estimatedDuration}s`} />
            <Metric label="Words/sec" value={String(project.script.wordsPerSecond)} />
            <p className={project.script.estimatedDuration > project.brief.targetDuration + 2 ? "warning-text" : "good-text"}>
              {project.script.estimatedDuration > project.brief.targetDuration + 2
                ? "Too many words for the selected duration."
                : "Timing is within working range."}
            </p>
            <div className="line-list">
              {project.script.lines.map((line) => (
                <article className="script-line" key={line.id}>
                  <span>{line.lineNumber}</span>
                  <div>
                    <div className="line-controls">
                      <label>
                        Type
                        <select value={line.type} onChange={(event) => updateScriptLine(line.id, { type: event.target.value as ScriptLineType })}>
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
                          disabled={["music", "sound-effect", "pause", "note"].includes(line.type)}
                        >
                          <option value="">Unassigned</option>
                          {project.voiceRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.roleName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="danger-button" onClick={() => deleteScriptLine(line.id)} disabled={project.script.lines.length <= 1}>
                        Delete
                      </button>
                    </div>
                    <strong>{line.speaker ?? line.type}</strong>
                    <textarea
                      className="line-textarea"
                      defaultValue={line.text}
                      onBlur={(event) => updateScriptLine(line.id, { text: event.target.value })}
                    />
                    <small>{line.startTime.toFixed(1)}-{line.endTime.toFixed(1)}s · {line.emotionalIntent.join(", ")} · {line.performanceNote}</small>
                    <textarea
                      className="line-note"
                      defaultValue={line.performanceNote}
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
          <Panel title="Voice Casting" icon={<Mic size={18} />}>
            <div className="card-grid">
              {project.voiceRoles.map((role) => (
                <article className="voice-card" key={role.id}>
                  <h3>{role.roleName}</h3>
                  <p>{role.characterDescription}</p>
                  <span>{role.accent}</span>
                  <small>{role.performanceNotes}</small>
                  <small>Provider: {role.provider} · {role.rightsNotes}</small>
                </article>
              ))}
            </div>
            <button className="primary" onClick={generateMockTake}>
              Generate mock take record
            </button>
          </Panel>
          <Panel title="Takes" icon={<FileAudio size={18} />}>
            {project.voiceTakes.length === 0 ? <p>No takes yet. Mock provider is ready without credentials.</p> : null}
            {project.voiceTakes.map((take) => (
              <div className="list-row" key={take.id}>
                <strong>Take {take.takeNumber}</strong>
                <span>{take.notes}</span>
              </div>
            ))}
            {mode === "producer" && (
              <pre className="code-note">
                ElevenLabs and NVIDIA Riva adapters are present but disabled in-browser. Add a server proxy before real calls.
              </pre>
            )}
          </Panel>
        </section>
      )}

      {activeTab === "Sound" && (
        <section className="studio-grid">
          <Panel title="Sound World" icon={<Sparkles size={18} />}>
            <Metric label="Location" value="Scripted world" />
            <Metric label="Texture" value="Natural, restrained, mnemonic-led" />
            <Metric label="Opening hook" value={project.soundCues[0]?.label ?? "Add a stronger sonic hook"} />
            <div className="card-grid">
              {project.soundCues.map((cue) => (
                <article className="voice-card" key={cue.id}>
                  <h3>{cue.label}</h3>
                  <p>{cue.notes}</p>
                  <small>{cue.startTime.toFixed(1)}s</small>
                </article>
              ))}
            </div>
          </Panel>
          <Panel title="Timeline" icon={<SlidersHorizontal size={18} />}>
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
        </section>
      )}

      {activeTab === "Mix" && (
        <section className="panel">
          <SectionHeader title="Mix Engineer" detail="Rough mix planning only. Final loudness and true peak need production QC." />
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
        </section>
      )}

      {activeTab === "Craft Quality" && (
        <section className="studio-grid">
          <Panel title="Craft Quality" icon={<Sparkles size={18} />}>
            <div className="quality-score">{project.craftQuality.overallScore}</div>
            <h2>{project.craftQuality.scoreBand}</h2>
            <p className="large-note">
              {project.craftQuality.overallScore < 75
                ? "This is not quite ready. One more craft pass recommended."
                : project.craftQuality.overallScore >= 85
                  ? "Highly crafted draft. Check production, rights, and final mix before export."
                  : "Strong enough for producer review. Human approval still required."}
            </p>
            <button className="primary">Improve craft</button>
          </Panel>
          <Panel title="Suggested Actions" icon={<Wand2 size={18} />}>
            {craftActions.map((action) => (
              <button className="action-row" key={action}>
                {action}
              </button>
            ))}
            <h3>Sub-scores</h3>
            {project.craftQuality.subScores.map((score) => (
              <div className="score-row" key={score.label}>
                <strong>{score.label}</strong>
                <span>{score.score}/10</span>
                <small>{score.improvement}</small>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {activeTab === "Export" && (
        <section className="studio-grid">
          <Panel title="Export Package" icon={<Download size={18} />}>
            <Metric label="Preset" value={preset.name} />
            <Metric label="Station" value={`${selectedStation.name} · ${selectedStation.confidenceLevel}`} />
            <label>
              Approval status
              <select
                value={project.approvalStatus}
                onChange={(event) =>
                  setProject((p) => recomputeProject({ ...p, approvalStatus: event.target.value as ApprovalStatus }, "Approval status changed"))
                }
              >
                {approvalStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <div className="export-buttons">
              <button onClick={() => downloadBlob(`${exportName}-project.json`, exportProjectJson(project))}>Project JSON</button>
              <button onClick={() => downloadText(`${exportName}-script.md`, scriptMarkdown(project))}>Script MD</button>
              <button onClick={() => downloadText(`${exportName}-cue-sheet.md`, cueSheetMarkdown(project))}>Cue Sheet</button>
              <button onClick={() => downloadText(`${exportName}-qc.md`, qcMarkdown(project))}>QC Report</button>
              <button onClick={() => downloadText(`${exportName}-craft-quality.md`, craftQualityMarkdown(project))}>Craft Quality</button>
              <button onClick={() => downloadText(`${exportName}-production-notes.md`, productionNotesMarkdown(project))}>Production Notes</button>
            </div>
          </Panel>
          <Panel title="QC Checks" icon={<CheckCircle2 size={18} />}>
            {project.qcResults.map((result) => (
              <div className={`qc-row ${result.status}`} key={result.id}>
                <strong>{result.check}</strong>
                <span>{result.status}</span>
                <p>{result.explanation}</p>
                <small>{result.recommendedFix}</small>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {activeTab === "Craft Memory" && (
        <section className="studio-grid">
          <Panel title="Craft Memory" icon={<Sparkles size={18} />}>
            {project.craftMemory.map((item) => (
              <article className="memory-card" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.principle}</p>
                <small>{item.example}</small>
              </article>
            ))}
          </Panel>
          <Panel title="Command Log" icon={<Wand2 size={18} />}>
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
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <SectionHeader title={title} icon={icon} />
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
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
