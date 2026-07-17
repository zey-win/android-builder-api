const {
  errorPayload,
  githubFetch,
  handleOptions,
  safeString,
  sendJson
} = require("../lib/shared");
const { loadDb } = require("./configs");

const CONFIG_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const CONFIGS_PATH = "configs.json";

// Build-infra metadata that the CI matrix needs but the builder UI (configs.json)
// does not capture. Keyed by lowercased "owner/repo".
const REPO_META = {
  "zey-win/unstopable": { unity_version: "6000.1.0f1", signing_profile: "playsocialgames", patch_type: "unstopable", icon_path: "Assets/Art/icon.png" },
  "zey-win/wheel-of-fortune": { unity_version: "6000.0.71f1", signing_profile: "playsocialgames", patch_type: "luckywheel", icon_path: "Assets/Sprites/Catcher Wheel Icon.png" },
  "zey-win/slotspot": { unity_version: "6000.0.71f1", signing_profile: "slotspot", patch_type: "slotspot", icon_path: "Assets/Game/art/icon.png" },
  "zey-win/blackjack": { unity_version: "6000.0.71f1", signing_profile: "playsocialgames", patch_type: "blackjack", icon_path: "Assets/Sprites/icon.png" },
  "zey-win/roulette": { unity_version: "6000.1.0f1", signing_profile: "playsocialgames", patch_type: "roulette", icon_path: "Assets/Roulette Icon.png" },
  "zey-win/dragon-tiger": { unity_version: "6000.0.71f1", signing_profile: "playmax", patch_type: "dragontiger", icon_path: "Assets/UI/baccarat_logo.png" },
  "zey-win/baccarat-tiger": { unity_version: "6000.0.71f1", signing_profile: "playsocialgames", patch_type: "baccarat", icon_path: "Assets/UI/Dragon Tiger Icon.png" },
  "zey-win/plinko": { unity_version: "6000.0.71f1", signing_profile: "playsocialgames", patch_type: "plinko", icon_path: "" }
};

async function loadConfigsFile() {
  try {
    const data = await githubFetch(`/repos/${CONFIG_REPO}/contents/${CONFIGS_PATH}`);
    let text = null;
    if (data && data.content) {
      text = Buffer.from(data.content, "base64").toString("utf8");
    } else if (data && data.download_url) {
      const raw = await fetch(data.download_url);
      if (raw.ok) text = await raw.text();
    }
    if (text) {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.configs) ? parsed.configs : [];
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      console.error("loadConfigsFile failed", err && err.message);
    }
  }
  return [];
}

// Map a builder-UI config (configs.json / db.games) into the CI build-matrix schema
// consumed by .ci-patches/generate-build-matrix.py.
function mapConfig(c) {
  const repo = c.game_repository || c.repo || "";
  const meta = REPO_META[repo.toLowerCase()] || {};
  const usesSdk = typeof c.uses_zeywin_sdk === "boolean"
    ? c.uses_zeywin_sdk
    : Boolean(c.zeywin_api_key || c.zeywin_sdk_version);
  const hasFirebase = c.firebase_cfg != null && c.firebase_cfg !== "";
  const usesFirebase = typeof c.uses_firebase === "boolean"
    ? c.uses_firebase
    : Boolean(hasFirebase || c.firebase_json_base64);

  return {
    name: c.name || c.app_name || c.label || "",
    repo,
    ref: c.ref || meta.ref || "main",
    package_name: c.package_name || "",
    app_name: c.app_name || c.label || c.name || "",
    version_name: safeString(c.version_name),
    version_code: safeString(c.version_code),
    icon_path: c.icon_path || meta.icon_path || "",
    icon_url: c.icon_url || meta.icon_url || "",
    icon_base64: c.icon_base64 || "",
    google_services_path: c.google_services_path || "",
    zeywin_api_key: c.zeywin_api_key || "",
    admob_app_id: c.admob_app_id || "",
    admob_banner_id: c.admob_banner_id || c.admob_banner || "",
    admob_interstitial_id: c.admob_interstitial_id || c.admob_interstitial || "",
    admob_rewarded_id: c.admob_rewarded_id || c.admob_rewarded || "",
    admob_rewarded_interstitial_id: c.admob_rewarded_interstitial_id || c.admob_rewarded_interstitial || "",
    admob_native_id: c.admob_native_id || c.admob_native || "",
    admob_app_open_id: c.admob_app_open_id || c.admob_app_open || "",
    uses_zeywin_sdk: usesSdk,
    uses_firebase: usesFirebase,
    unity_version: c.unity_version || meta.unity_version || "",
    signing_profile: c.signing_profile || meta.signing_profile || "",
    patch_type: c.patch_type || meta.patch_type || ""
  };
}

async function buildGames() {
  const configs = await loadConfigsFile();

  // Overlay dynamic db.games (written via /api/configs) on top of the static
  // configs.json presets so live edits win when both exist.
  let dbGames = [];
  try {
    const { db } = await loadDb();
    dbGames = Array.isArray(db.games) ? db.games : [];
  } catch {
    dbGames = [];
  }

  const byKey = new Map();
  for (const c of configs) {
    byKey.set(c.id || c.package_name, c);
  }
  for (const g of dbGames) {
    const key = g.id || g.package_name;
    byKey.set(key, { ...(byKey.get(key) || {}), ...g });
  }

  return [...byKey.values()]
    .map(mapConfig)
    .filter((g) => g.repo && g.package_name);
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const section = safeString(url.searchParams.get("section"));

    if (section === "icons" || section === "builds") {
      const { db } = await loadDb();
      sendJson(req, res, 200, { ok: true, [section]: db[section] || [] });
      return;
    }

    const games = await buildGames();
    sendJson(req, res, 200, { ok: true, games, count: games.length });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};

module.exports.buildGames = buildGames;
module.exports.mapConfig = mapConfig;
