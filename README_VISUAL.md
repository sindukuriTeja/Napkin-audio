# Napkin Audio AI Studio: Visual & Feature Guide

This guide provides a visual map of the **Napkin Audio AI Studio** UI to help you understand the production workflow and the "AI Director" capabilities.

## 1. The Production Sidebar (Left)
The studio is organized into a sequential radio production workflow, grouped into three sections:

Project:
- **Studio**: High-level health check, AI Craft Quality score, project status, and the "generate full production plan" entry point (Llama 3 via Ollama).
- **Brief**: Define the brand, target audience, tone, and mandatories.

Production:
- **Script**: The engine that breaks down raw text into timed voice, SFX, and music lines.
- **Voices**: Cast roles using ElevenLabs or Mock voices, generate speech takes, run the VO Voice Transformer, and render a full-spot MP3.
- **Sound Design**: Manage SFX and music cues on a visual timeline.
- **Mix**: AI-assisted leveling, ducking recommendations, and browser-based (Web Audio) mix rendering.

Delivery:
- **Compliance**: QC checks for duration, mandatories, CTA, legal speed, voice assignment, rights, and station specs.
- **Export**: Station-specific packaging, presets, and download formats.
- **Memory**: Command log, version history, and studio knowledge retrieval hits.

## 2. The Main Studio Console (Center)
- **Status Cards**: Real-time feedback on script duration vs. target duration.
- **Visual Timeline**: A color-coded map of your 30s/60s spot:
  - **Blue**: Voiceover / Dialogue
  - **Green**: Music beds
  - **Orange**: Sound Effects (SFX)
- **Live Preview**: Transport controls to play back the "mental mix" or rendered audio.

## 3. The AI Director (Right)
This is your proactive creative assistant. It monitors your project and suggests:
- **Creative Moves**: "Add a stronger opening hook," "Tighten the ending."
- **Technical Fixes**: "Legal line is too fast," "Music is fighting the voice."
- **Interactive Commands**: You can type or **speak** commands (e.g., "Slow down the legal line") and the AI will propose changes for you to Apply or Reject.

## 4. Key AI Components
### The Script Parser
Automatically identifies line types:
- `ANNOUNCER:` -> Character/Voice
- `SFX:` -> Sound Effect
- `MUSIC:` -> Music bed
- `[Pause]` -> Timing break

### Craft Quality Score
A 0-100 rating based on:
- **Idea Strength**: Is the brand and CTA clear?
- **Timing Discipline**: Does it fit the 30s slot?
- **Emotional Impact**: Does the script have a "turn" or "reveal"?

## 5. Local-First Architecture
- **Mock Providers**: Works offline by generating synthetic "beep" placeholders for voices/SFX.
- **ElevenLabs Integration**: When the server proxy is running, it generates high-fidelity speech, sound effects, music, dubbing, and full-spot MP3 renders.
- **Llama 3 via Ollama**: When Ollama is running locally, the Studio tab can turn a single text input into a full script, voice-role, sound-cue, and music-cue plan.
- **RAG Knowledge**: Uses a built-in retrieval layer (seed data plus an imported knowledge dataset) to give you industry-standard advice on radio mixing and compliance.

---
*Created to help you navigate the Napkin Audio AI Studio MVP.*
