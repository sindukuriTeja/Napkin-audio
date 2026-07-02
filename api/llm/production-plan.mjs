import { corsHeaders } from "../_lib/shared.mjs";

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  res.writeHead(501, { "Content-Type": "application/json", ...corsHeaders(origin) });
  res.end(JSON.stringify({
    error: "LLM production planning requires a local Ollama instance and is not available in serverless deployments.",
    detail: "To use AI-powered script generation, run the project locally with Ollama installed. See README.md for instructions.",
  }));
}
