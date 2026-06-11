import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mockElevenLabsVoices, providerStatus } from "../server/provider-proxy.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const importedKnowledgePath = resolve(repoRoot, "src/data/importedStudioKnowledge.ts");
const importedKnowledge = readFileSync(importedKnowledgePath, "utf8");
const importedKnowledgeCount = (importedKnowledge.match(/"id":/g) ?? []).length;

const status = providerStatus({
  ELEVENLABS_API_KEY: "demo-secret",
  ELEVENLABS_DEFAULT_VOICE_ID: "",
  NVIDIA_RIVA_ENDPOINT: "",
  NVIDIA_RIVA_API_KEY: "",
  NVIDIA_NIM_API_KEY: "",
});

assert(status.elevenLabs.configured === true, "Provider status should detect an ElevenLabs key.");
assert(status.elevenLabs.defaultVoiceIdConfigured === false, "Provider status should report missing default voice.");
assert(!JSON.stringify(status).includes("demo-secret"), "Provider status must not expose API keys.");
assert(mockElevenLabsVoices.length >= 3, "Mock voice catalog should include demo-safe options.");
assert(mockElevenLabsVoices.every((voice) => voice.source === "mock"), "Mock voice catalog must be clearly labelled.");
assert(importedKnowledgeCount >= 25, "Imported RAG knowledge should contain at least 25 items.");

console.log("Napkin Audio AI Studio demo readiness checks passed.");
console.log(`Imported RAG knowledge items: ${importedKnowledgeCount}`);
console.log(`Mock voice catalog options: ${mockElevenLabsVoices.length}`);
