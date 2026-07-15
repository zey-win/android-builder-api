const {
  errorPayload,
  githubFetch,
  handleOptions,
  loadAllBuildInputs,
  safeString,
  sendJson
} = require("./_shared");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    const runId = safeString(req.query?.runId);
    if (!runId) {
      sendJson(req, res, 400, { ok: false, error: "runId is required" });
      return;
    }

    // Find the run by ID from GitHub Actions
    const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
    const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
    const data = await githubFetch(
      `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=100`
    );

    const run = (data.workflow_runs || []).find((item) => String(item.id) === runId);
    if (!run) {
      sendJson(req, res, 404, { ok: false, error: "Run not found" });
      return;
    }

    // Parse displayTitle: "Android: AppName / package.name / format / runId"
    const raw = `${run.display_title || ""} ${run.name || ""}`;
    const parts = raw.replace(/^Android:\s*/i, "").split(" / ").map((p) => p.trim());
    const appName = parts[0] || "";
    const packageName = parts[1] || "";
    const buildFormat = parts[2] || "apk";

    // Load persisted build inputs (stored by api/build.js when the build was dispatched)
    const allInputs = await loadAllBuildInputs();
    const inputs = allInputs[runId] || {};

    // Build config from persisted inputs, falling back to parsed run title
    const config = {
      game_repository: safeString(inputs.game_repository || "zey-win/plinko"),
      game_ref: safeString(inputs.game_ref || "main"),
      package_name: safeString(inputs.package_name || packageName),
      app_name: safeString(inputs.app_name || appName),
      build_format: safeString(inputs.build_format || buildFormat),
      version_mode: safeString(inputs.version_mode || "auto_next"),
      version_name: safeString(inputs.version_name || ""),
      version_code: safeString(inputs.version_code || ""),
      aab_version_name: safeString(inputs.aab_version_name || ""),
      aab_version_code: safeString(inputs.aab_version_code || ""),
      zeywin_api_key: safeString(inputs.zeywin_api_key || ""),
      zeywin_sdk_version: safeString(inputs.zeywin_sdk_version || "v3.9.37"),
      signing_profile: safeString(inputs.signing_profile || "slotspot"),
      fast_build: safeString(inputs.fast_build || "false"),
      admob_android_app_id: safeString(inputs.admob_android_app_id || ""),
      admob_android_banner_id: safeString(inputs.admob_android_banner_id || ""),
      admob_android_interstitial_id: safeString(inputs.admob_android_interstitial_id || ""),
      admob_android_rewarded_id: safeString(inputs.admob_android_rewarded_id || ""),
      admob_android_rewarded_interstitial_id: safeString(inputs.admob_android_rewarded_interstitial_id || ""),
      admob_android_native_id: safeString(inputs.admob_android_native_id || ""),
      admob_android_app_open_id: safeString(inputs.admob_android_app_open_id || ""),
      firebase_json_base64: safeString(inputs.firebase_json_base64 || ""),
      icon_png_path: safeString(inputs.icon_png_path || ""),
      icon_png_base64: safeString(inputs.icon_png_base64 || ""),
      icon_foreground_base64: safeString(inputs.icon_foreground_base64 || ""),
    };

    // Resolve icon URL from stored inputs
    let iconUrl = null;
    if (config.icon_png_path && config.icon_png_path.startsWith("http")) {
      iconUrl = config.icon_png_path;
    } else if (config.icon_png_base64) {
      iconUrl = `data:image/png;base64,${config.icon_png_base64}`;
    } else if (config.icon_foreground_base64) {
      iconUrl = `data:image/png;base64,${config.icon_foreground_base64}`;
    }

    sendJson(req, res, 200, {
      ok: true,
      config,
      icon_url: iconUrl,
      run: { id: run.id, displayTitle: run.display_title || run.name },
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
