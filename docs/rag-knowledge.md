# Studio knowledge retrieval

Napkin Audio AI Studio now includes a local seed knowledge layer that works without API keys.

## What is built

- `src/data/studioKnowledge.ts` stores curated studio knowledge chunks for radio script timing, voice casting, sound design, mix targets, export QC, and compliance risk.
- `src/data/importedStudioKnowledge.ts` stores imported RAG package items generated from the Manus dataset.
- `scripts/import-napkin-rag.mjs` converts a validated `napkin-audio-rag` folder into app-readable `StudioKnowledgeItem` records.
- `StudioKnowledgeAgent.retrieve(project)` scores those chunks against the current project brief, parsed script, voice roles, QC issues, and agent recommendations.
- The Dashboard shows the top producer-assistant knowledge hits.
- The Memory tab shows the fuller retrieved guidance with source labels.

## Current boundary

This is a lightweight local RAG-style retriever with imported Manus knowledge, not a full vector database pipeline yet. It does not call OpenAI, ElevenLabs, Pinecone, Supabase, or any external embedding service. It is safe for demos and works offline.

## Imported package

The first imported package was `Napkin Audio AI Studio RAG Knowledge Dataset` version `1.0.0`, created `2026-06-11`.

It imported:

- 15 knowledge documents
- 10 operational tables
- 25 total app-readable knowledge items

The provided validation report passed before import.

## Re-import command

Extract the RAG zip so the folder containing `manifest.json` is available, then run:

```bash
node scripts/import-napkin-rag.mjs /path/to/napkin-audio-rag
```

This rewrites `src/data/importedStudioKnowledge.ts`.

## Next ingestion path

When the Manus knowledge pack is ready, structure it as small source-backed chunks:

- `title`
- `topic`
- `productionStage`
- `appliesTo`
- `summary`
- `guidance`
- `keywords`
- `source`
- `reliability`

The importer converts that dataset into `StudioKnowledgeItem` records, with a later option to move from keyword retrieval to embeddings when API credentials are available.
