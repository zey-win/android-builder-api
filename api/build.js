const {
  assertRepo,
  assertSimpleRef,
  errorPayload,
  githubFetch,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

const PNG_MAGIC = "89504e470d0a1a0a";
const DEFAULT_ICON_PATH = "Assets/ZeyWin/IconOverride/android-icon.png";
const WORKFLOW_INPUT_KEYS = [
  "game_repository",
  "game_ref",
  "package_name",
  "app_name",
  "icon_png_path",
  "zeywin_api_key",
  "version_mode",
  "version_name",
  "version_code",
  "build_format",
  "publish_to_google_play",
  "google_play_track",
  "google_play_status",
  "require_google_play_upload",
  "admob_android_app_id",
  "admob_android_banner_id",
  "admob_android_interstitial_id",
  "admob_android_rewarded_id",
  "admob_android_rewarded_interstitial_id",
  "admob_android_native_id",
  "admob_android_app_open_id"
];

function normalizePng(value) {
  const raw = safeString(value);
  if (!raw) return null;

  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length < 8 || buffer.subarray(0, 8).toString("hex") !== PNG_MAGIC) {
    const error = new Error("Selected icon must be a PNG image.");
    error.statusCode = 400;
    throw error;
  }

  if (buffer.length > 2_500_000) {
    const error = new Error("Selected icon PNG is too large. Use a PNG below 2.5 MB.");
    error.statusCode = 413;
    throw error;
  }

  return buffer;
}

function normalizeIconPath(value) {
  const path = safeString(value, DEFAULT_ICON_PATH).replace(/^\.?\//, "");
  if (!/^Assets\/[A-Za-z0-9_./ -]+\.png$/.test(path) || path.includes("..")) {
    const error = new Error("Icon path must be a PNG file under Assets/.");
    error.statusCode = 400;
    throw error;
  }
  return path;
}

function encodeContentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function commitIcon({ repo, branch, iconPath, iconBuffer }) {
  const encodedPath = encodeContentPath(iconPath);
  let existingSha = null;

  try {
    const existing = await githubFetch(`/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`);
    existingSha = existing.sha || null;
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  const body = {
    message: `Update Android builder icon (${iconPath})`,
    content: iconBuffer.toString("base64"),
    branch
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const result = await githubFetch(`/repos/${repo}/contents/${encodedPath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return {
    path: iconPath,
    commitSha: result.commit?.sha || null,
    htmlUrl: result.content?.html_url || null
  };
}

function buildWorkflowInputs(payload, iconPath) {
  const inputs = {
    game_repository: safeString(payload.game_repository),
    game_ref: safeString(payload.game_ref, "main"),
    package_name: safeString(payload.package_name),
    app_name: safeString(payload.app_name),
    icon_png_path: iconPath || safeString(payload.icon_png_path),
    zeywin_api_key: safeString(payload.zeywin_api_key),
    version_mode: safeString(payload.version_mode, "auto_next"),
    version_name: safeString(payload.version_name),
    version_code: safeString(payload.version_code),
    build_format: "apk",
    publish_to_google_play: "false",
    google_play_track: "production",
    google_play_status: "completed",
    require_google_play_upload: "false",
    admob_android_app_id: safeString(payload.admob_android_app_id),
    admob_android_banner_id: safeString(payload.admob_android_banner_id),
    admob_android_interstitial_id: safeString(payload.admob_android_interstitial_id),
    admob_android_rewarded_id: safeString(payload.admob_android_rewarded_id),
    admob_android_rewarded_interstitial_id: safeString(payload.admob_android_rewarded_interstitial_id),
    admob_android_native_id: safeString(payload.admob_android_native_id),
    admob_android_app_open_id: safeString(payload.admob_android_app_open_id)
  };

  return Object.fromEntries(WORKFLOW_INPUT_KEYS.map((key) => [key, inputs[key] || ""]));
}

async function dispatchWorkflow(inputs) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  const ciRef = process.env.CI_REF || "main";

  await githubFetch(`/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: ciRef, inputs })
  });

  return {
    repository: ciRepository,
    workflow: ciWorkflow,
    ref: ciRef,
    workflowUrl: `https://github.com/${ciRepository}/actions/workflows/${ciWorkflow}`,
    actionsUrl: `https://github.com/${ciRepository}/actions`
  };
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
    const gameRepository = safeString(payload.game_repository);
    const gameRef = safeString(payload.game_ref, "main");
    assertRepo(gameRepository);
    assertSimpleRef(gameRef);

    const iconBuffer = normalizePng(payload.icon_png_base64 || payload.iconDataUrl);
    let iconResult = null;
    let iconPath = safeString(payload.icon_png_path);

    if (iconBuffer) {
      iconPath = normalizeIconPath(iconPath);
      iconResult = await commitIcon({
        repo: gameRepository,
        branch: gameRef,
        iconPath,
        iconBuffer
      });
    }

    const inputs = buildWorkflowInputs(
      {
        ...payload,
        game_repository: gameRepository,
        game_ref: gameRef
      },
      iconResult?.path || iconPath
    );

    const dispatch = await dispatchWorkflow(inputs);

    sendJson(req, res, 200, {
      ok: true,
      dispatchedAt: new Date().toISOString(),
      expectedSeconds: 600,
      icon: iconResult,
      workflow: dispatch,
      inputs: {
        ...inputs,
        zeywin_api_key: inputs.zeywin_api_key ? "masked" : "",
        admob_android_app_id: inputs.admob_android_app_id ? "masked" : "",
        admob_android_banner_id: inputs.admob_android_banner_id ? "masked" : "",
        admob_android_interstitial_id: inputs.admob_android_interstitial_id ? "masked" : "",
        admob_android_rewarded_id: inputs.admob_android_rewarded_id ? "masked" : ""
      }
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
