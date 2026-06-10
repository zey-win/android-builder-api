const {
  errorPayload,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

const DEFAULT_SIZE = "1024x1024";

function requireOpenAiKey() {
  const key = safeString(process.env.OPENAI_API_KEY);
  if (!key) {
    const error = new Error("Server is missing OPENAI_API_KEY.");
    error.statusCode = 500;
    throw error;
  }
  return key;
}

function cleanPrompt(value) {
  return safeString(value)
    .replace(/\s+/g, " ")
    .slice(0, 1200);
}

function buildIconPrompt(payload) {
  const appName = cleanPrompt(payload.app_name || payload.appName || "Android game");
  const repository = cleanPrompt(payload.game_repository || payload.repository || "Unity game");
  const description = cleanPrompt(payload.description || "");
  const style = cleanPrompt(payload.style || "premium mobile game icon, vibrant, readable at small size");

  return [
    `Create a polished 512x512 Android launcher icon for the Unity game "${appName}".`,
    `Game template: ${repository}.`,
    description ? `Game description: ${description}.` : "",
    `Style: ${style}.`,
    "Use a single strong centered symbol, high contrast, no tiny text, no UI screenshots, no white Unity logo overlay.",
    "Square composition, rounded-safe margins, production app store quality."
  ].filter(Boolean).join(" ");
}

async function generateIconBase64(prompt) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: process.env.OPENAI_IMAGE_SIZE || DEFAULT_SIZE
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `OpenAI image generation failed: ${response.status}`);
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  const base64 = data.data?.[0]?.b64_json;
  if (!base64) {
    const error = new Error("OpenAI did not return image data.");
    error.statusCode = 502;
    error.details = data;
    throw error;
  }
  return base64;
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "POST") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);
    const payload = await readJson(req, 32_000);
    const prompt = buildIconPrompt(payload);
    const base64 = await generateIconBase64(prompt);

    sendJson(req, res, 200, {
      ok: true,
      prompt,
      icon: {
        path: "Assets/ZeyWin/IconOverride/android-icon.png",
        dataUrl: `data:image/png;base64,${base64}`
      }
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
