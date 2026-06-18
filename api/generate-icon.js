const {
  errorPayload,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

const PROMPTS = {
  "zey-win/plinko": "Plinko game app icon, falling balls bouncing through pegs, bright neon style, gold coins, casino theme, vibrant colors, 3D render style, 1024x1024",
  "zey-win/blackjack": "Blackjack game app icon, ace of spades and king of hearts cards, green felt table, poker chips, premium casino style, gold accents, 1024x1024",
  "zey-win/roulette": "Roulette wheel app icon, spinning roulette wheel with red and black numbers, golden ball, casino background, dramatic lighting, 1024x1024",
  "zey-win/dragon-tiger": "Dragon vs Tiger card game app icon, fierce dragon on one side, orange tiger on the other, gold and red theme, casino card duel, 1024x1024",
  "zey-win/baccarat-tiger": "Baccarat tiger casino game app icon, majestic tiger face, playing cards, gold casino chips, dark green background, premium elegant style, 1024x1024",
  "zey-win/wheel-of-fortune": "Wheel of Fortune game app icon, colorful prize wheel with multiple segments, golden pointer, lucky spin concept, bright festive colors, 1024x1024",
  "zey-win/Unstopable": "Unstopable racing game app icon, fast sports car, speed motion blur, neon lights, asphalt track, adrenaline action style, dark theme with bright accents, 1024x1024",
  "zey-win/SlotSpot": "Slot machine game app icon, classic slot machine with lucky 7s, cherries, golden bells, BAR symbols, bright neon casino style, 1024x1024"
};

async function generateImage(prompt) {
  const keys = [process.env.OPENAI_API_KEY_1, process.env.OPENAI_API_KEY_2].filter(Boolean);
  let lastError = null;

  for (const key of keys) {
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt,
          n: 1,
          size: "1024x1024",
          response_format: "b64_json"
        })
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        lastError = `OpenAI error ${response.status}: ${errText}`;
        if (response.status !== 429 && response.status !== 500) break;
        continue;
      }

      const data = await response.json();
      if (data.data && data.data[0] && data.data[0].b64_json) {
        return `data:image/png;base64,${data.data[0].b64_json}`;
      }
      lastError = "Invalid response format from OpenAI";
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(lastError || "All API keys failed");
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "POST") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const payload = await readJson(req);
    const repo = safeString(payload.game_repository || payload.repository);
    const customPrompt = safeString(payload.prompt);

    if (!customPrompt && !repo) {
      sendJson(req, res, 400, { ok: false, error: "Provide game_repository or prompt." });
      return;
    }

    const prompt = customPrompt || PROMPTS[repo];
    if (!prompt) {
      sendJson(req, res, 400, { ok: false, error: `No default prompt for ${repo}. Provide custom prompt.` });
      return;
    }

    const dataUrl = await generateImage(prompt);

    sendJson(req, res, 200, {
      ok: true,
      repository: repo || "custom",
      prompt,
      icon: {
        dataUrl,
        source: "openai-dall-e-3"
      }
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};