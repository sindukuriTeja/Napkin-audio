import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = resolve(process.argv[2] ?? "");
const outputPath = resolve(repoRoot, "src/data/importedStudioKnowledge.ts");

const allowedStages = new Set(["brief", "script", "casting", "recording", "sound_design", "music", "mix", "master", "export", "compliance"]);
const allowedAppliesTo = new Set(["radio", "podcast", "digital", "social", "dubbing", "music", "sfx"]);

const stageAliases = {
  copywriting: "script",
  delivery: "export",
  localization: "dubbing",
  troubleshooting: "mix",
  workflow: "brief",
};

const appliesToAliases = {
  ai_voice: "dubbing",
  broadcast: "radio",
  web: "digital",
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const cleanMarkdown = (value) =>
  value
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[[0-9]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const sentencesFromMarkdown = (markdown, limit = 4) => {
  const body = markdown
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith(">") &&
        !trimmed.startsWith("**Document ID") &&
        !trimmed.startsWith("**Recommended") &&
        !trimmed.startsWith("**Primary") &&
        !trimmed.startsWith("`") &&
        !trimmed.startsWith("[")
      );
    })
    .join(" ");
  const sentences = cleanMarkdown(body)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35 && !sentence.includes("Source links"))
    .slice(0, limit);
  return sentences.length ? sentences : [cleanMarkdown(markdown).slice(0, 220)];
};

const normalizeList = (values, allowed, aliases) =>
  [...new Set((values ?? []).map((value) => aliases[value] ?? value).filter((value) => allowed.has(value)))];

const parseCsv = (source) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const [headers = [], ...records] = rows;
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), (record[index] ?? "").trim()])),
  );
};

const tableTopicMap = {
  ad_duration_word_count_table: { stage: ["script"], appliesTo: ["radio", "podcast", "digital"], keywords: ["duration", "word count", "timing"] },
  loudness_export_targets_table: { stage: ["mix", "master", "export"], appliesTo: ["radio", "podcast", "digital", "social"], keywords: ["loudness", "true peak", "export"] },
  mix_problem_diagnosis_table: { stage: ["mix"], appliesTo: ["radio", "podcast", "digital"], keywords: ["mix", "diagnosis", "music", "voice"] },
  voice_style_use_case_table: { stage: ["casting", "recording"], appliesTo: ["radio", "dubbing"], keywords: ["voice", "casting", "style"] },
  sfx_type_use_case_table: { stage: ["sound_design"], appliesTo: ["radio", "sfx"], keywords: ["sfx", "sound design", "foley"] },
  music_mood_bpm_table: { stage: ["music"], appliesTo: ["radio", "music", "digital"], keywords: ["music", "score", "bpm", "mood"] },
  script_problem_fix_table: { stage: ["script"], appliesTo: ["radio", "digital"], keywords: ["script", "copy", "fix"] },
  client_feedback_translation_table: { stage: ["brief", "script"], appliesTo: ["radio", "digital"], keywords: ["client feedback", "translation", "revision"] },
  compliance_risk_flags_table: { stage: ["compliance", "export"], appliesTo: ["radio", "digital"], keywords: ["compliance", "risk", "legal"] },
  final_export_qa_table: { stage: ["export", "compliance"], appliesTo: ["radio", "digital"], keywords: ["export", "qa", "delivery"] },
};

if (!datasetRoot || !existsSync(join(datasetRoot, "manifest.json"))) {
  throw new Error("Usage: node scripts/import-napkin-rag.mjs /path/to/napkin-audio-rag");
}

const manifest = readJson(join(datasetRoot, "manifest.json"));
const items = [];

for (const doc of manifest.documents ?? []) {
  const metadata = readJson(join(datasetRoot, doc.metadata_path));
  const markdown = readFileSync(join(datasetRoot, doc.path), "utf8");
  const sourceUrls = metadata.source_urls?.length ? ` Sources: ${metadata.source_urls.join(", ")}` : "";
  items.push({
    id: metadata.id,
    title: metadata.title,
    topic: metadata.topic,
    productionStage: normalizeList(metadata.production_stage, allowedStages, stageAliases),
    appliesTo: normalizeList(metadata.applies_to, allowedAppliesTo, appliesToAliases),
    summary: metadata.summary,
    guidance: sentencesFromMarkdown(markdown, 5),
    keywords: [...new Set([...(metadata.keywords ?? []), ...(metadata.suggested_tags ?? []), ...(metadata.example_user_queries ?? [])])],
    source: `${manifest.title} ${manifest.version}: ${doc.path}.${sourceUrls}`,
    reliability: "imported",
  });
}

for (const table of manifest.tables ?? []) {
  const csvPath = join(datasetRoot, table.csv_path);
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const key = basename(table.csv_path, ".csv");
  const mapping = tableTopicMap[key] ?? { stage: ["brief"], appliesTo: ["radio"], keywords: [] };
  const guidance = rows.slice(0, 6).map((row) => Object.values(row).filter(Boolean).join(" | "));
  items.push({
    id: table.id,
    title: table.title,
    topic: key,
    productionStage: mapping.stage,
    appliesTo: mapping.appliesTo,
    summary: `Operational lookup table imported from ${table.csv_path}.`,
    guidance,
    keywords: [...new Set([key.replace(/_/g, " "), ...mapping.keywords, table.title])],
    source: `${manifest.title} ${manifest.version}: ${table.csv_path}`,
    reliability: "imported",
  });
}

const output = `import type { StudioKnowledgeItem } from "../types/models";

// Generated by scripts/import-napkin-rag.mjs from ${manifest.title} ${manifest.version}.
// Re-run the importer when the external RAG package changes.
export const importedStudioKnowledgeItems: StudioKnowledgeItem[] = ${JSON.stringify(items, null, 2)};
`;

writeFileSync(outputPath, output);
console.log(`Imported ${items.length} RAG knowledge items into ${outputPath}`);
