import { corsHeaders } from "../_lib/shared.mjs";

export default function handler(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const status = {
    elevenLabs: {
      configured: Boolean(process.env.ELEVENLABS_API_KEY),
      defaultVoiceIdConfigured: Boolean(process.env.ELEVENLABS_DEFAULT_VOICE_ID),
      capabilities: {
        speech: Boolean(process.env.ELEVENLABS_API_KEY),
        soundEffects: Boolean(process.env.ELEVENLABS_API_KEY),
        music: Boolean(process.env.ELEVENLABS_API_KEY),
        dubbing: Boolean(process.env.ELEVENLABS_API_KEY),
        voiceChanger: Boolean(process.env.ELEVENLABS_API_KEY),
      },
    },
    nvidiaRiva: {
      configured: Boolean(process.env.NVIDIA_RIVA_ENDPOINT && process.env.NVIDIA_RIVA_API_KEY),
      endpointConfigured: Boolean(process.env.NVIDIA_RIVA_ENDPOINT),
    },
    nvidiaNim: {
      configured: Boolean(process.env.NVIDIA_NIM_API_KEY),
    },
    claude: {
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      model: anthropicModel,
      capabilities: {
        scriptPlanning: true,
        voiceCasting: true,
        soundDesign: true,
      },
    },
  };

  res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(origin) });
  res.end(JSON.stringify(status, null, 2));
}
