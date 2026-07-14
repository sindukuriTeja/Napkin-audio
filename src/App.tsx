import { Mp3Encoder } from "@breezystack/lamejs";
import { useState, useMemo } from "react";
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

type Step = "script" | "voice" | "sound-design";

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
  const [step, setStep] = useState<Step>("script");
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

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Napkin Audio AI Studio</h1>
        <div className="step-indicator">
          <span className={step === "script" ? "active" : ""}>1. Script</span>
          <span className={step === "voice" ? "active" : ""}>2. Voice</span>
          <span className={step === "sound-design" ? "active" : ""}>3. Sound Design</span>
        </div>
      </header>

      {statusMessage && <div className="status-bar">{statusMessage}</div>}

      {step === "script" && (
        <div className="step-content">
          <div className="input-section">
            <textarea
              className="script-textarea"
              placeholder="Paste your script here, or describe the ad you want to create (product, audience, tone, duration)..."
              value={scriptDraft}
              onChange={(e) => setScriptDraft(e.target.value)}
              disabled={isGenerating}
            />
            <div className="button-row">
              <button
                className="btn primary"
                onClick={handleGenerateAndAlign}
                disabled={isGenerating || !scriptDraft.trim()}
              >
                {isGenerating ? "Generating..." : "Generate & Align Script"}
              </button>
              <button
                className="btn secondary"
                onClick={handleParseScript}
                disabled={isGenerating || !scriptDraft.trim()}
              >
                Parse Script
              </button>
            </div>
          </div>

          {parsedLines.length > 1 && (
            <div className="parsed-preview">
              <h3>Parsed Lines</h3>
              {parsedLines.map((line) => (
                <div key={line.id} className="parsed-line">
                  <span className="line-type">{line.type}</span>
                  <span className="line-speaker">{line.speaker || "—"}</span>
                  <span className="line-text">{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "voice" && (
        <div className="step-content">
          <div className="model-selector">
            <h3>Voice Model</h3>
            <div className="segmented">
              <button
                className={ttsModel === "eleven_multilingual_v2" ? "active" : ""}
                onClick={() => setTtsModel("eleven_multilingual_v2")}
              >
                v2 stable
              </button>
              <button
                className={ttsModel === "eleven_v3" ? "active" : ""}
                onClick={() => setTtsModel("eleven_v3")}
              >
                v3 most expressive
              </button>
            </div>
          </div>

          <div className="button-row">
            <button
              className="btn primary"
              onClick={handleGenerateVoiceTakes}
              disabled={isGeneratingVoice}
            >
              {isGeneratingVoice ? "Generating..." : "Generate Voice Take (All Characters)"}
            </button>
            <button
              className="btn secondary"
              onClick={handleGenerateFullSpot}
              disabled={isGeneratingFullSpot}
            >
              {isGeneratingFullSpot ? "Generating..." : "Generate Full Spot MP3 File"}
            </button>
          </div>

          {project.voiceTakes.length > 0 && (
            <div className="takes-list">
              <h3>Voice Takes ({project.voiceTakes.length})</h3>
              {project.voiceTakes.map((take) => (
                <div key={take.id} className="take-item">
                  <span>{take.notes}</span>
                  {take.audioUrl && <audio controls src={take.audioUrl} />}
                </div>
              ))}
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
          <div className="model-selector">
            <h3>Sound Design Model</h3>
            <div className="segmented">
              <button
                className={musicModel === "music_v1" ? "active" : ""}
                onClick={() => setMusicModel("music_v1")}
              >
                v1 stable
              </button>
              <button
                className={musicModel === "music_v2" ? "active" : ""}
                onClick={() => setMusicModel("music_v2")}
              >
                v2 studio-grade
              </button>
            </div>
          </div>

          <div className="button-row">
            <button
              className="btn primary"
              onClick={handleGenerateMixedPreview}
              disabled={isGeneratingMix}
            >
              {isGeneratingMix ? "Rendering..." : "Generate Full Mixed Preview"}
            </button>
            <button
              className="btn secondary"
              onClick={handleAutoGenerateAll}
              disabled={isAutoGenerating}
            >
              {isAutoGenerating ? "Processing..." : "Auto Generate All & Mix"}
            </button>
          </div>

          {mixedAudioUrl && (
            <div className="mixed-player">
              <h3>Mixed Preview</h3>
              <audio controls src={mixedAudioUrl} />
              <button className="btn ghost" onClick={() => {
                const a = document.createElement("a");
                a.href = mixedAudioUrl;
                a.download = "mixed-preview.mp3";
                a.click();
              }}>
                Download Mix
              </button>
            </div>
          )}

          <div className="nav-row">
            <button className="btn ghost" onClick={() => setStep("voice")}>← Back to Voice</button>
          </div>
        </div>
      )}
    </div>
  );
}
