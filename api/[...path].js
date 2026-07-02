// Vercel serverless entry point for the provider proxy.
//
// This lets the whole app — frontend + backend — deploy as a single Vercel
// project: Vercel builds the Vite app as static output and turns every file
// under /api into its own serverless function. Because this file uses a
// catch-all route ("[...path]"), any request to /api/* (e.g.
// /api/voice/elevenlabs/voices, /api/providers/status) lands here with the
// full path on `request.url`, which is exactly what routeProviderProxyRequest
// already expects — so no route-handling logic is duplicated between this
// deployment shape and the plain-Node server used for local dev / Render.
//
// Configure the same environment variables here as you would for the
// standalone server (ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_VOICE_ID, etc.)
// in the Vercel project's Settings -> Environment Variables. Do NOT prefix
// them with VITE_ — that would bake them into the public frontend bundle.
import { routeProviderProxyRequest } from "../server/provider-proxy.mjs";

// Give ElevenLabs full-spot rendering (several sequential API calls) room to
// finish. Vercel Hobby projects may cap this lower than 60s regardless —
// check your plan's function duration limit if long renders start timing out.
export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  return routeProviderProxyRequest(request, response, process.env);
}
