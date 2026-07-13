const {
  assertRepo,
  assertSimpleRef,
  buildReleaseAssetLinks,
  errorPayload,
  githubFetch,
  handleOptions,
  parseKeyValueText,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

const PNG_MAGIC = "89504e470d0a1a0a";
const DEFAULT_ICON_PATH = "Assets/ZeyWin/IconOverride/android-icon.png";
const FIREBASE_PATHS = {
  "google-services.json": "Assets/Plugins/Android/google-services.json",
  "google-services-desktop.json": "Assets/google-services-desktop.json"
};
const WORKFLOW_INPUT_KEYS = [
  "builder_request_id",
  "game_repository",
  "game_ref",
  "package_name",
  "app_name",
  "icon_png_path",
  "icon_png_base64",
  "zeywin_api_key",
  "zeywin_sdk_version",
  "version_mode",
  "version_name",
  "version_code",
  "aab_version_name",
  "aab_version_code",
  "build_format",
  "fast_build",
  "signing_profile",
  "admob_android_app_id",
  "admob_android_banner_id",
  "admob_android_interstitial_id",
  "admob_android_rewarded_id",
  "firebase_json_base64"
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

function normalizeFirebaseFile(payload) {
  const raw = safeString(payload.firebase_json_base64 || payload.firebaseJsonBase64);
  if (!raw) return null;

  const fileName = safeString(payload.firebase_file_name || payload.firebaseFileName || "google-services.json");
  const targetName = fileName.toLowerCase().includes("desktop")
    ? "google-services-desktop.json"
    : "google-services.json";
  const targetPath = FIREBASE_PATHS[targetName];
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 1_000_000) {
    const error = new Error("Firebase config is too large.");
    error.statusCode = 413;
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    const error = new Error("Firebase config must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }

  const pretty = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return {
    path: targetPath,
    name: targetName,
    buffer: pretty,
    projectId: parsed.project_info?.project_id || "",
    packageName: parsed.client?.[0]?.client_info?.android_client_info?.package_name || "",
    appId: parsed.client?.[0]?.client_info?.mobilesdk_app_id || ""
  };
}

function encodeContentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function commitFile({ repo, branch, filePath, buffer, message }) {
  const encodedPath = encodeContentPath(filePath);
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
    message,
    content: buffer.toString("base64"),
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
    path: filePath,
    commitSha: result.commit?.sha || null,
    htmlUrl: result.content?.html_url || null
  };
}

function buildWorkflowInputs(payload, iconPath) {
  const buildFormat = safeString(payload.build_format, "apk");
  const normalizedBuildFormat = ["apk", "aab", "apk_aab"].includes(buildFormat) ? buildFormat : "apk";
  const inputs = {
    builder_request_id: safeString(payload.builder_request_id),
    game_repository: safeString(payload.game_repository),
    game_ref: safeString(payload.game_ref, "main"),
    package_name: safeString(payload.package_name),
    app_name: safeString(payload.app_name),
    icon_png_path: iconPath || safeString(payload.icon_png_path),
    icon_png_base64: safeString(payload.icon_png_base64 || payload.iconDataUrl),
    zeywin_api_key: safeString(payload.zeywin_api_key),
    zeywin_sdk_version: safeString(payload.zeywin_sdk_version),
    version_mode: safeString(payload.version_mode, "auto_next"),
    version_name: safeString(payload.version_name),
    version_code: safeString(payload.version_code),
    aab_version_name: safeString(payload.aab_version_name),
    aab_version_code: safeString(payload.aab_version_code),
    build_format: normalizedBuildFormat,
    fast_build: safeString(payload.fast_build, "true") === "false" ? "false" : "true",
    signing_profile: safeString(payload.signing_profile, "playmax"),
    admob_android_app_id: safeString(payload.admob_android_app_id),
    admob_android_banner_id: safeString(payload.admob_android_banner_id),
    admob_android_interstitial_id: safeString(payload.admob_android_interstitial_id),
    admob_android_rewarded_id: safeString(payload.admob_android_rewarded_id),
    firebase_json_base64: safeString(payload.firebase_json_base64 || payload.firebaseJsonBase64)
  };

  return Object.fromEntries(WORKFLOW_INPUT_KEYS.map((key) => [key, inputs[key] || ""]));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function findWorkflowRun({ requestId, createdAfter }) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  const createdAt = new Date(createdAfter.getTime() - 15_000);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const data = await githubFetch(
      `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=20`
    );

    const run = (data.workflow_runs || []).find((item) => {
      const itemDate = new Date(item.created_at || 0);
      const title = `${item.display_title || ""} ${item.name || ""}`;
      return itemDate >= createdAt && title.includes(requestId);
    });

    if (run) {
      return {
        id: run.id,
        runNumber: run.run_number,
        runAttempt: run.run_attempt,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        htmlUrl: run.html_url,
        displayTitle: run.display_title || run.name
      };
    }

    await sleep(1200);
  }

  return null;
}

async function getLatestArtifact(packageName) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const path = `builds/${packageName}/latest-build.txt`;
  try {
    const file = await githubFetch(`/repos/${ciRepository}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=main`);
    const text = Buffer.from(file.content || "", "base64").toString("utf8");
    const meta = parseKeyValueText(text);
    const assets = buildReleaseAssetLinks(meta);
    const apkDownload = assets.find((asset) => asset.type === "APK")?.downloadUrl || "";
    const aabDownload = assets.find((asset) => asset.type === "AAB")?.downloadUrl || "";

    return {
      packageName,
      versionName: meta.version_name || "",
      versionCode: meta.version_code || "",
      buildFormat: meta.build_format || "",
      releaseUrl: meta.github_release || meta.apk_release || "",
      assetName: meta.package_assets || meta.aab_asset || meta.apk_asset || "",
      assets,
      downloadUrl: assets[0]?.downloadUrl || "",
      apkDownloadUrl: apkDownload,
      aabDownloadUrl: aabDownload,
      repoPath: meta.package_repo_paths || meta.aab_path || meta.apk_path || meta.package_repo_path || "",
      apkAsset: meta.apk_asset || "",
      apkPath: meta.apk_path || "",
      aabAsset: meta.aab_asset || "",
      aabPath: meta.aab_path || "",
      builtAt: meta.built_at_utc || ""
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
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
    const requestId = safeString(payload.builder_request_id, `builder-${Date.now().toString(36)}`);
    assertRepo(gameRepository);
    assertSimpleRef(gameRef);

    const packageName = safeString(payload.package_name);
    const appName = safeString(payload.app_name);
    if (!packageName) {
      const error = new Error("Package name is required to start a build. Set the Package Name (e.g. com.example.app) before building.");
      error.statusCode = 400;
      throw error;
    }
    if (!appName) {
      const error = new Error("App name is required to start a build. Set the App name before building.");
      error.statusCode = 400;
      throw error;
    }

    const firebaseFile = normalizeFirebaseFile(payload);
    let iconResult = null;
    let firebaseResult = null;
    let iconPath = safeString(payload.icon_png_path);

    const GITHUB_INPUT_LIMIT = 60000;

    // Pass firebase as base64
    let firebaseBase64 = "";
    if (firebaseFile) {
      firebaseBase64 = firebaseFile.buffer.toString("base64");
      try {
        firebaseResult = await commitFile({
          repo: gameRepository,
          branch: gameRef,
          filePath: firebaseFile.path,
          buffer: firebaseFile.buffer,
          message: `Update Android builder Firebase config (${firebaseFile.name})`
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Firebase config commit failed (protected branch?):", err && err.message);
        firebaseResult = null;
      }
    }

    // Pass icon as base64 only if combined size fits GitHub workflow input limit
    let iconPngBase64 = "";
    const iconRaw = payload.icon_png_base64 || payload.iconDataUrl || "";
    if (iconRaw && !iconRaw.startsWith("http")) {
      const iconBuffer = normalizePng(iconRaw);
      if (iconBuffer) {
        const encoded = iconBuffer.toString("base64");
        if (firebaseBase64.length + encoded.length < GITHUB_INPUT_LIMIT) {
          iconPngBase64 = encoded;
        }
      }
    }

    const inputs = buildWorkflowInputs(
      {
        ...payload,
        builder_request_id: requestId,
        game_repository: gameRepository,
        game_ref: gameRef,
        firebase_json_base64: firebaseBase64,
        icon_png_base64: iconPngBase64
      },
      iconPath
    );

    const dispatchStartedAt = new Date();
    const dispatch = await dispatchWorkflow(inputs);
    const run = await findWorkflowRun({ requestId, createdAfter: dispatchStartedAt });

    sendJson(req, res, 200, {
      ok: true,
      requestId,
      dispatchedAt: new Date().toISOString(),
      expectedSeconds: 600,
      icon: iconResult,
      firebase: firebaseResult ? {
        ...firebaseResult,
        projectId: firebaseFile.projectId,
        packageName: firebaseFile.packageName,
        appId: firebaseFile.appId
      } : null,
      workflow: dispatch,
      run,
      latestArtifact: await getLatestArtifact(inputs.package_name),
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
