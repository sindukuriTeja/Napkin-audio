# Studio knowledge retrieval

Napkin Audio AI Studio now includes a local seed knowledge layer that works without API keys.

## What is built

- `src/data/studioKnowledge.ts` stores curated studio knowledge chunks for radio script timing, voice casting, sound design, mix targets, export QC, and compliance risk.
- `StudioKnowledgeAgent.retrieve(project)` scores those chunks against the current project brief, parsed script, voice roles, QC issues, and agent recommendations.
- The Dashboard shows the top producer-assistant knowledge hits.
- The Memory tab shows the fuller retrieved guidance with source labels.

## Current boundary

This is a lightweight local RAG-style retriever, not a full vector database pipeline yet. It does not call OpenAI, ElevenLabs, Pinecone, Supabase, or any external embedding service. It is safe for demos and works offline.

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

Codex can then add an importer that converts the dataset into `StudioKnowledgeItem` records, with a later option to move from keyword retrieval to embeddings when API credentials are available.
