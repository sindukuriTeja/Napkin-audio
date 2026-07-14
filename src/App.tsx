import { Mp3Encoder } from "@breezystack/lamejs";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Sun, Moon, Mic, Music, Wand2, Sparkles, Volume2, Download, Play, ChevronRight, Radio, Headphones, ArrowRight } from "lucide-react";
import { ScriptParserAgent, SoundDesignAgent } from "./agents/studioAgents";
import { createProject, recomputeProject, updateScriptFromText } from "./data/sampleProject";
import { downloadBlob } from "./export/exportPackage";
import { createId } from "./lib/id";
import { assignVoiceRolesToScript, lineSupportsVoiceRole } from "./lib/scriptRoles";
import {
  generateLlmProductionPlan,
  generateElevenLabsSpeechPreview,
  generateElevenLabsFullSpot,
  generateElevenLabsSoundEffect,
  generateElevenLabsMusic,
  fetchElevenLabsVoices,
  type LlmProductionPlan,
  type FullSpotLine,
  type ProviderVoice,
  type ElevenLabsMusicModel,
} from "./services/providerProxy";
import { generateMockVoicePreviewBlob } from "./services/voiceProviders";
import type { Project, VoiceRole, VoiceTake, SoundCue, MusicCue } from "./types/models";

type Theme = "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("napkin-audio-ai-studio-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("napkin-audio-ai-studio-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return [theme, toggle];
}

type Step = "welcome" | "script" | "voice" | "sound-design";

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
  const sampleBlockSize = 1152;
  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    const rightChunk = right ? right.subarray(i, i + sampleBlockSize) : undefined;
    const encoded = encoder.encodeBuffer(leftChunk, rightChunk);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) chunks.push(finalChunk);
  const blobParts = chunks.map((chunk) => new Uint8Array(chunk));
  return new Blob(blobParts, { type: "audio/mp3" });
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [step, setStep] = useState<Step>("welcome");
  const [project, setProject] = useState<Project>(() => createProject());
  const [scriptDraft, setScriptDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [ttsModel, setTtsModel] = useState<"eleven_multilingual_v2" | "eleven_v3">("eleven_multilingual_v2");
  const [musicModel, setMusicModel] = useState<ElevenLabsMusicModel>("music_v1");
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [isGeneratingFullSpot, setIsGeneratingFullSpot] = useState(false);
  const [isGeneratingMix, setIsGeneratingMix] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [mixedAudioUrl, setMixedAudioUrl] = useState<string | null>(null);

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
          accent: role.accent || "Irish",
          emotionalStyle: role.emotionalStyle || "clear",
          pace: role.pace || "conversational",
          performanceNotes: role.performanceNotes || "Natural, clear, and specific.",
          pronunciationNotes: role.pronunciationNotes || "",
          provider: "elevenlabs",
          providerVoiceId: "XB0fDUnXU5powFXDhCwa",
          rightsNotes: "ElevenLabs voice assigned by default.",
        }))
      : parsedProject.voiceRoles;

    const roleByName = new Map(voiceRoles.map((role) => [role.roleName.toLowerCase(), role.id]));
    const firstSpokenRole = voiceRoles[0]?.id;
    const legalRole = voiceRoles.find((role) => role.pace === "fast-read")?.id ?? firstSpokenRole;
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
      return { id: createId("sfx"), lineId: linkedLine?.id, label: cue.label || "AI sound cue", location: cue.location || "Claude production plan", texture: cue.texture || "Supportive and uncluttered", sfxMoment: cue.sfxMoment || cue.label || "subtle radio sound effect", foley: cue.foley || "Generated by ElevenLabs", startTime, endTime: Math.max(endTime, startTime + 0.5), notes: cue.notes || "AI-designed SFX prompt." };
    });

    const musicCues: MusicCue[] = plan.musicCues.map((cue) => {
      const startTime = Number(cue.startTime ?? 0);
      const endTime = Number(cue.endTime ?? parsedProject.brief.targetDuration);
      return { id: createId("music"), label: cue.label || "AI music bed", style: cue.style || "radio bed", tempo: cue.tempo || "medium", instrumentation: cue.instrumentation || "minimal production music", mood: cue.mood || "clear", startTime, endTime: Math.max(endTime, startTime + 3), notes: cue.elevenLabsMusicPrompt || `${cue.style}, ${cue.mood}, ${cue.instrumentation}` };
    });

    return recomputeProject({ ...parsedProject, script: { ...parsedProject.script, lines: scriptLines }, voiceRoles, soundCues, musicCues }, "Claude generated production plan");
  };

  const handleGenerateAndAlign = async () => {
    if (!scriptDraft.trim()) {
      setStatusMessage("Please enter a description or script text first.");
      return;
    }
    setIsGenerating(true);
    setStatusMessage("Generating script with Claude AI...");
    try {
      const plan = await generateLlmProductionPlan({
        input: scriptDraft,
        brief: project.brief as unknown as Record<string, unknown>,
        targetDuration: project.brief.targetDuration,
      });
      const newProject = applyLlmPlanToProject(project, plan);
      setProject(newProject);
      setScriptDraft(newProject.script.rawText);
      setStatusMessage("Script generated! Review and click Parse Script to continue.");
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : "Generation failed"}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleParseScript = () => {
    if (!scriptDraft.trim()) {
      setStatusMessage("Please enter a script first.");
      return;
    }
    const parsed = ScriptParserAgent.parse(scriptDraft, project.brief.targetDuration);
    const updatedProject = recomputeProject({ ...project, script: parsed, scriptLocked: true }, "Script parsed");
    const voiceState = assignVoiceRolesToScript(updatedProject.script, updatedProject.brief, updatedProject.voiceRoles, { preserveAssignedRoles: false });
    setProject({ ...updatedProject, ...voiceState });
    setStatusMessage(`Parsed ${parsed.lines.length} lines. Moving to voice generation.`);
    setStep("voice");
  };

  const handleGenerateVoiceTakes = async () => {
    setIsGeneratingVoice(true);
    setStatusMessage("Generating voice takes for all characters...");
    try {
      const spokenLines = project.script.lines.filter((line) => !["music", "sound-effect", "pause", "note"].includes(line.type));
      const takes: VoiceTake[] = [];
      for (const line of spokenLines) {
        const role = project.voiceRoles.find((r) => r.id === line.assignedVoiceRoleId) ?? project.voiceRoles[0];
        const voiceId = role?.providerVoiceId || "XB0fDUnXU5powFXDhCwa";
        try {
          const blob = await generateElevenLabsSpeechPreview({
            text: line.text,
            voiceId,
            modelId: ttsModel,
          });
          const audioUrl = URL.createObjectURL(blob);
          takes.push({
            id: createId("take"),
            roleId: role?.id ?? "voice-announcer",
            lineId: line.id,
            takeNumber: 1,
            provider: "elevenlabs" as const,
            settings: { model: ttsModel },
            performanceNotes: line.performanceNote,
            audioUrl,
            isMock: false,
            isPreferred: true,
            notes: "Generated via ElevenLabs",
            createdAt: new Date().toISOString(),
          });
        } catch {
          const mockBlob = generateMockVoicePreviewBlob(line.text);
          const audioUrl = URL.createObjectURL(mockBlob);
          takes.push({
            id: createId("take"),
            roleId: role?.id ?? "voice-announcer",
            lineId: line.id,
            takeNumber: 1,
            provider: "mock" as const,
            settings: { model: "mock" },
            performanceNotes: line.performanceNote,
            audioUrl,
            isMock: true,
            isPreferred: true,
            notes: "Mock take (ElevenLabs unavailable)",
            createdAt: new Date().toISOString(),
          });
        }
      }
      setProject((prev) => ({ ...prev, voiceTakes: [...prev.voiceTakes, ...takes] }));
      setStatusMessage(`Generated ${takes.length} voice takes.`);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : "Voice generation failed"}`);
    } finally {
      setIsGeneratingVoice(false);
    }
  };

  const handleGenerateFullSpot = async () => {
    setIsGeneratingFullSpot(true);
    setStatusMessage("Generating full spot MP3...");
    try {
      const spokenLines = project.script.lines.filter((line) => !["music", "sound-effect", "pause", "note"].includes(line.type));
      const lines: FullSpotLine[] = spokenLines.map((line) => {
        const role = project.voiceRoles.find((r) => r.id === line.assignedVoiceRoleId);
        return {
          text: line.text,
          voiceId: role?.providerVoiceId || "XB0fDUnXU5powFXDhCwa",
          pauseAfterMs: (line.pauseAfter || 0.3) * 1000,
        };
      });
      const blob = await generateElevenLabsFullSpot(lines);
      downloadBlob("full-spot.mp3", blob);
      setStatusMessage("Full spot MP3 downloaded!");
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : "Full spot generation failed"}`);
    } finally {
      setIsGeneratingFullSpot(false);
    }
  };

  const handleGenerateMixedPreview = async () => {
    setIsGeneratingMix(true);
    setStatusMessage("Rendering mixed preview...");
    try {
      const ctx = new AudioContext();
      const buffers: AudioBuffer[] = [];
      for (const take of project.voiceTakes.filter((t) => t.isPreferred && t.audioUrl)) {
        const response = await fetch(take.audioUrl!);
        const arrayBuf = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuf);
        buffers.push(decoded);
      }
      if (buffers.length === 0) {
        setStatusMessage("No voice takes to mix. Generate voice takes first.");
        setIsGeneratingMix(false);
        return;
      }
      const totalLength = buffers.reduce((sum, buf) => sum + buf.length + Math.floor(ctx.sampleRate * 0.3), 0);
      const offlineCtx = new OfflineAudioContext(1, totalLength, ctx.sampleRate);
      let offset = 0;
      for (const buf of buffers) {
        const source = offlineCtx.createBufferSource();
        source.buffer = buf;
        source.connect(offlineCtx.destination);
        source.start(offset / ctx.sampleRate);
        offset += buf.length + Math.floor(ctx.sampleRate * 0.3);
      }
      const rendered = await offlineCtx.startRendering();
      const mp3Blob = audioBufferToMp3(rendered);
      if (mixedAudioUrl) URL.revokeObjectURL(mixedAudioUrl);
      const url = URL.createObjectURL(mp3Blob);
      setMixedAudioUrl(url);
      setStatusMessage("Mixed preview ready! Use the player below.");
      ctx.close();
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : "Mix rendering failed"}`);
    } finally {
      setIsGeneratingMix(false);
    }
  };

  const handleAutoGenerateAll = async () => {
    setIsAutoGenerating(true);
    setStatusMessage("Auto-generating all audio and mixing...");
    try {
      await handleGenerateVoiceTakes();
      const { soundCues } = SoundDesignAgent.buildCues(project);
      for (const cue of soundCues.slice(0, 3)) {
        try {
          const blob = await generateElevenLabsSoundEffect({ text: cue.sfxMoment, modelId: "eleven_text_to_sound_v2" });
          cue.audioUrl = URL.createObjectURL(blob);
        } catch { /* skip */ }
      }
      const prompts = SoundDesignAgent.productionPrompts(project);
      for (const musicCue of project.musicCues.slice(0, 1)) {
        try {
          const blob = await generateElevenLabsMusic({ prompt: musicCue.notes || prompts.musicPrompt, modelId: musicModel });
          musicCue.audioUrl = URL.createObjectURL(blob);
        } catch { /* skip */ }
      }
      setProject((prev) => ({ ...prev, soundCues: [...prev.soundCues, ...soundCues] }));
      setStatusMessage("All audio generated. Rendering final mix...");
      await handleGenerateMixedPreview();
      setStatusMessage("Auto-generation complete! Mixed preview ready.");
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : "Auto-generation failed"}`);
    } finally {
      setIsAutoGenerating(false);
    }
  };

  const parsedLines = project.script.lines;
  const stepIndex = step === "welcome" ? -1 : step === "script" ? 0 : step === "voice" ? 1 : 2;

  return (
    <div className="app-container">
      <div className="top-bar" />

      <header className="app-header">
        <div className="header-left">
          <div className="logo-mark">
            <Radio size={16} />
          </div>
          <h1>Napkin Audio</h1>
          <span className="header-badge">Studio</span>
        </div>
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? (
            <Sun className="theme-toggle-icon" size={14} />
          ) : (
            <Moon className="theme-toggle-icon" size={14} />
          )}
        </button>
      </header>

      {step !== "welcome" && (
        <div className="step-indicator">
          <button
            className={`step-pill ${step === "script" ? "active" : stepIndex > 0 ? "completed" : ""}`}
            onClick={() => setStep("script")}
          >
            <span className="step-number">1</span>
            <span>Script</span>
          </button>
          <span className="step-connector" />
          <button
            className={`step-pill ${step === "voice" ? "active" : stepIndex > 1 ? "completed" : ""}`}
            onClick={() => stepIndex >= 1 && setStep("voice")}
          >
            <span className="step-number">2</span>
            <span>Voice</span>
          </button>
          <span className="step-connector" />
          <button
            className={`step-pill ${step === "sound-design" ? "active" : ""}`}
            onClick={() => stepIndex >= 2 && setStep("sound-design")}
          >
            <span className="step-number">3</span>
            <span>Mix</span>
          </button>
        </div>
      )}

      {statusMessage && (
        <div className="status-bar">
          <Sparkles size={12} />
          <span>{statusMessage}</span>
        </div>
      )}

      {step === "welcome" && (
        <div className="welcome-section">
          <div className="hero">
            <div className="hero-content">
              <h2 className="hero-title">
                Create radio ads with AI-powered audio production
              </h2>
              <p className="hero-subtitle">
                Write a script, generate professional voices, add sound design, and export broadcast-ready audio — all in one place.
              </p>
              <button className="btn primary large" onClick={() => setStep("script")}>
                Get Started
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <Wand2 size={18} />
              </div>
              <h3>AI Script Writing</h3>
              <p>Describe your ad and let AI generate a professional radio script with timing and roles.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Mic size={18} />
              </div>
              <h3>Voice Generation</h3>
              <p>Choose from expressive AI voices powered by ElevenLabs with multi-character support.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Music size={18} />
              </div>
              <h3>Sound Design</h3>
              <p>AI-generated sound effects and music beds that complement your script perfectly.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Headphones size={18} />
              </div>
              <h3>Final Mix & Export</h3>
              <p>Mix all elements together and export broadcast-ready MP3 files in seconds.</p>
            </div>
          </div>

          <div className="how-it-works">
            <h3 className="section-title">How it works</h3>
            <div className="steps-flow">
              <div className="flow-step">
                <div className="flow-number">1</div>
                <div className="flow-content">
                  <h4>Write or Generate</h4>
                  <p>Paste your script or describe what you need — AI handles the rest</p>
                </div>
              </div>
              <div className="flow-arrow">
                <ChevronRight size={14} />
              </div>
              <div className="flow-step">
                <div className="flow-number">2</div>
                <div className="flow-content">
                  <h4>Generate Voices</h4>
                  <p>AI creates natural-sounding voice takes for each character</p>
                </div>
              </div>
              <div className="flow-arrow">
                <ChevronRight size={14} />
              </div>
              <div className="flow-step">
                <div className="flow-number">3</div>
                <div className="flow-content">
                  <h4>Mix & Export</h4>
                  <p>Add music and SFX, then download your finished audio</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "script" && (
        <div className="step-content">
          <div className="section-header">
            <Wand2 size={16} className="section-icon" />
            <div>
              <h2 className="section-title">Script Editor</h2>
              <p className="section-desc">Write your script or describe the ad you want to create</p>
            </div>
          </div>

          <div className="input-section">
            <div className="textarea-wrapper">
              <textarea
                className="script-textarea"
                placeholder="Example: Create a 30-second radio ad for a new coffee shop called 'Morning Brew' targeting young professionals. Tone should be warm and energetic..."
                value={scriptDraft}
                onChange={(e) => setScriptDraft(e.target.value)}
                disabled={isGenerating}
              />
              <div className="textarea-footer">
                <span className="char-count">{scriptDraft.length} characters</span>
                <div className="textarea-icon">
                  <Mic size={12} />
                </div>
              </div>
            </div>
            <div className="button-row">
              <button
                className="btn primary"
                onClick={handleGenerateAndAlign}
                disabled={isGenerating || !scriptDraft.trim()}
              >
                <Sparkles size={12} />
                {isGenerating ? "Generating..." : "Generate with AI"}
              </button>
              <button
                className="btn secondary"
                onClick={handleParseScript}
                disabled={isGenerating || !scriptDraft.trim()}
              >
                <Play size={14} />
                Parse & Continue
              </button>
            </div>
          </div>

          {parsedLines.length > 1 && (
            <div className="parsed-preview">
              <div className="parsed-header">
                <h3>Parsed Script</h3>
                <span className="line-count">{parsedLines.length} lines</span>
              </div>
              {parsedLines.map((line) => (
                <div key={line.id} className="parsed-line">
                  <span className="line-type" data-type={line.type}>{line.type}</span>
                  <span className="line-speaker" data-speaker={line.speaker || ""}>{line.speaker || "—"}</span>
                  <span className="line-text">{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "voice" && (
        <div className="step-content">
          <div className="section-header">
            <Mic size={16} className="section-icon" />
            <div>
              <h2 className="section-title">Voice Generation</h2>
              <p className="section-desc">Generate AI voice takes for each character in your script</p>
            </div>
          </div>

          <div className="card">
            <div className="model-selector">
              <h3>Voice Model</h3>
              <div className="segmented">
                <button
                  className={ttsModel === "eleven_multilingual_v2" ? "active" : ""}
                  onClick={() => setTtsModel("eleven_multilingual_v2")}
                >
                  <Volume2 size={12} />
                  v2 Stable
                </button>
                <button
                  className={ttsModel === "eleven_v3" ? "active" : ""}
                  onClick={() => setTtsModel("eleven_v3")}
                >
                  <Sparkles size={12} />
                  v3 Expressive
                </button>
              </div>
            </div>
          </div>

          <div className="button-row">
            <button
              className="btn primary"
              onClick={handleGenerateVoiceTakes}
              disabled={isGeneratingVoice}
            >
              <Mic size={14} />
              {isGeneratingVoice ? "Generating..." : "Generate All Voice Takes"}
            </button>
            <button
              className="btn secondary"
              onClick={handleGenerateFullSpot}
              disabled={isGeneratingFullSpot}
            >
              <Download size={12} />
              {isGeneratingFullSpot ? "Generating..." : "Export Full Spot MP3"}
            </button>
          </div>

          {project.voiceTakes.length > 0 && (
            <div className="takes-list">
              <div className="parsed-header">
                <h3>Voice Takes</h3>
                <span className="line-count">{project.voiceTakes.length} takes</span>
              </div>
              {project.voiceTakes.map((take) => (
                <div key={take.id} className="take-item">
                  <div className="take-meta">
                    <span className="take-badge">{take.isMock ? "Mock" : "ElevenLabs"}</span>
                    <span className="take-note">{take.notes}</span>
                  </div>
                  {take.audioUrl && <audio controls src={take.audioUrl} />}
                </div>
              ))}
            </div>
          )}

          {project.voiceTakes.length === 0 && (
            <div className="empty-state">
              <Volume2 size={24} />
              <p>No voice takes yet. Click "Generate All Voice Takes" to create AI-powered voice recordings for your script.</p>
            </div>
          )}

          <div className="nav-row">
            <button className="btn ghost" onClick={() => setStep("script")}>← Back to Script</button>
            <button className="btn ghost" onClick={() => setStep("sound-design")}>Sound Design →</button>
          </div>
        </div>
      )}

      {step === "sound-design" && (
        <div className="step-content">
          <div className="section-header">
            <Music size={16} className="section-icon" />
            <div>
              <h2 className="section-title">Sound Design & Mix</h2>
              <p className="section-desc">Add music beds, sound effects, and render your final mix</p>
            </div>
          </div>

          <div className="card">
            <div className="model-selector">
              <h3>Music Model</h3>
              <div className="segmented">
                <button
                  className={musicModel === "music_v1" ? "active" : ""}
                  onClick={() => setMusicModel("music_v1")}
                >
                  <Music size={12} />
                  v1 Stable
                </button>
                <button
                  className={musicModel === "music_v2" ? "active" : ""}
                  onClick={() => setMusicModel("music_v2")}
                >
                  <Sparkles size={12} />
                  v2 Studio-Grade
                </button>
              </div>
            </div>
          </div>

          <div className="button-row">
            <button
              className="btn primary"
              onClick={handleAutoGenerateAll}
              disabled={isAutoGenerating}
            >
              <Sparkles size={12} />
              {isAutoGenerating ? "Processing..." : "Auto Generate All & Mix"}
            </button>
            <button
              className="btn secondary"
              onClick={handleGenerateMixedPreview}
              disabled={isGeneratingMix}
            >
              <Headphones size={14} />
              {isGeneratingMix ? "Rendering..." : "Render Mix Only"}
            </button>
          </div>

          {mixedAudioUrl && (
            <div className="mixed-player">
              <div className="parsed-header">
                <h3>Final Mix</h3>
                <button className="btn ghost small" onClick={() => {
                  const a = document.createElement("a");
                  a.href = mixedAudioUrl;
                  a.download = "mixed-preview.mp3";
                  a.click();
                }}>
                  <Download size={12} />
                  Download
                </button>
              </div>
              <audio controls src={mixedAudioUrl} />
            </div>
          )}

          {!mixedAudioUrl && (
            <div className="empty-state">
              <Headphones size={24} />
              <p>Your final mixed audio will appear here. Use "Auto Generate All & Mix" for a one-click production workflow.</p>
            </div>
          )}

          <div className="nav-row">
            <button className="btn ghost" onClick={() => setStep("voice")}>← Back to Voice</button>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>Napkin Audio AI Studio — Local-first AI audio production</p>
      </footer>
    </div>
  );
}
