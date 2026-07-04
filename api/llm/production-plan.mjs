import { corsHeaders } from "../_lib/shared.mjs";

export const config = {
  maxDuration: 120,
};

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const sanitizeJsonText = (text) => {
  let result = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      continue;
    }
    if (escapeNext) { result += ch; escapeNext = false; continue; }
    if (ch === "\\") { result += ch; escapeNext = true; continue; }
    if (ch === '"') {
      const rest = text.slice(i + 1).trimStart();
      if (/^[,}\]:]/.test(rest) || rest.length === 0) { inString = false; result += ch; continue; }
      result += '\\"';
      continue;
    }
    if (ch === "\n") { result += "\\n"; continue; }
    if (ch === "\r") { result += "\\r"; continue; }
    if (ch === "\t") { result += "\\t"; continue; }
    result += ch;
  }
  return result;
};

const extractJsonObject = (value) => {
  const raw = String(value ?? "").trim();
  const text = sanitizeJsonText(raw);
  try { return JSON.parse(text); } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("Claude response did not contain a JSON object.");
  }
};

const normalizeLlmPlan = (plan) => ({
  title: String(plan?.title ?? "AI generated audio script"),
  scriptLines: Array.isArray(plan?.scriptLines) ? plan.scriptLines : [],
  voiceRoles: Array.isArray(plan?.voiceRoles) ? plan.voiceRoles : [],
  soundCues: Array.isArray(plan?.soundCues) ? plan.soundCues : [],
  musicCues: Array.isArray(plan?.musicCues) ? plan.musicCues : [],
  mixNotes: String(plan?.mixNotes ?? ""),
});

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });

const llmSystemPrompt =
  'You are a senior radio/audio creative director and sound designer. Return only valid JSON. No markdown. ' +
  'Given ANY text input, autonomously decide: script structure, voice roles, sound effects, music, and a sonic logo. ' +
  'Rules: ALWAYS include at least one sound effect, a music bed, and a sonic logo/brand mnemonic at the end. ' +
  'SFX sfxMoment values must be highly descriptive ElevenLabs-ready prompts. ' +
  'Music prompts must specify genre, mood, instruments, tempo, energy. ' +
  'CRITICAL: output must be a single valid JSON object only. Never use literal " inside string values — use single quotes instead. ' +
  'JSON shape: {"title":"string","scriptLines":[{"speaker":"string","type":"voiceover|announcer|character|dialogue|sound-effect|music|pause|legal|cta|brand-mnemonic|note","text":"string","performanceNote":"string","assignedVoiceRoleName":"string"}],"voiceRoles":[{"roleName":"string","characterDescription":"string","ageRange":"string","accent":"string","emotionalStyle":"string","pace":"slow|measured|conversational|quick|fast-read","performanceNotes":"string","pronunciationNotes":"string","elevenLabsSearchQuery":"string"}],"soundCues":[{"lineNumber":1,"label":"string","location":"string","texture":"string","sfxMoment":"string","foley":"string","startTime":0,"endTime":2,"notes":"string"}],"musicCues":[{"label":"string","style":"string","tempo":"string","instrumentation":"string","mood":"string","startTime":0,"endTime":30,"notes":"string","elevenLabsMusicPrompt":"string"}],"mixNotes":"string"}';

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(origin) });
    res.end(JSON.stringify(body, null, 2));
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20241022";

  if (!apiKey) {
    return json(401, {
      error: "ANTHROPIC_API_KEY is not configured.",
      detail: "Add ANTHROPIC_API_KEY in your Vercel project Environment Variables and redeploy.",
    });
  }

  const body = await readBody(req);
  const input = String(body.input ?? "").trim();
  if (!input) return json(400, { error: "Missing required input." });
  if (input.length > 6000) return json(400, { error: "Input is too long. Keep it under 6000 characters." });

  const brief = body.brief && typeof body.brief === "object" ? body.brief : {};
  const targetDuration = Number(body.targetDuration ?? brief.targetDuration ?? 30);
  const voiceCatalog = Array.isArray(body.voiceCatalog) ? body.voiceCatalog.slice(0, 80) : [];

  const userPrompt = JSON.stringify({
    task: "From the input below, autonomously create a COMPLETE audio production plan.",
    productionInput: input,
    targetDurationSeconds: Number.isFinite(targetDuration) ? targetDuration : 30,
    brief,
    availableElevenLabsVoices: voiceCatalog.map((v) => ({ voiceId: v.voiceId, name: v.name, description: v.description, labels: v.labels })),
    instructions: [
      "Decide the conversation structure autonomously — speakers, emotional arc.",
      "Place sound effects at moments that enhance storytelling.",
      "Design a music bed with a specific ElevenLabs-ready prompt.",
      "Include a sonic logo as BOTH a scriptLine (brand-mnemonic) AND a soundCue.",
      "Every spoken scriptLine must have an assignedVoiceRoleName matching a voiceRole.",
      "Include performance notes for every spoken line.",
    ],
  });

  try {
    const providerResponse = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: llmSystemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!providerResponse.ok) {
      const detail = await providerResponse.text();
      return json(providerResponse.status, { error: "Claude API request failed.", detail: detail.slice(0, 400) });
    }

    const payload = await providerResponse.json();
    const text = Array.isArray(payload?.content)
      ? payload.content.map((b) => (b?.type === "text" ? String(b.text ?? "") : "")).join("")
      : "";

    if (payload?.stop_reason === "max_tokens") {
      // Attempt partial salvage
      try {
        const salvaged = normalizeLlmPlan(extractJsonObject(text));
        if (salvaged.scriptLines.length > 0) return json(200, salvaged);
      } catch {}
      return json(502, {
        error: "Claude's response was cut off before it finished.",
        detail: "Try a shorter description and generate again.",
      });
    }

    return json(200, normalizeLlmPlan(extractJsonObject(text)));
  } catch (error) {
    return json(502, {
      error: "Could not connect to the Claude API.",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
