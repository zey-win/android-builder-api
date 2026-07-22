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
  sendJson,
  saveBuildInputs
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

const DB_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const DB_PATH = "db.json";

async function getLatestVersionCode(packageName) {
  let latest = 0;
  try {
    const raw = await fetch("https://raw.githubusercontent.com/" + DB_REPO + "/main/builds/" + encodeURIComponent(packageName) + "/latest-build.txt");
    if (raw.ok) {
      const text = await raw.text();
      const m = text.match(/^version_code=(.+)$/m);
      if (m) {
        const ciCode = parseInt(m[1], 10);
        if (!isNaN(ciCode) && ciCode > latest) latest = ciCode;
      }
    }
  } catch {}
  return latest;
}

async function bumpVersionIfNeeded(payload) {
  const pkg = safeString(payload.package_name);
  if (!pkg) return payload;
  const versionCode = parseInt(payload.version_code, 10);
  if (isNaN(versionCode)) return payload;
  const versionName = safeString(payload.version_name);
  const aabVersionCode = parseInt(payload.aab_version_code, 10);
  const aabVersionName = safeString(payload.aab_version_name);
  try {
    const latest = await getLatestVersionCode(pkg);
    if (versionCode <= latest) {
      const bumpedCode = String(latest + 1);
      payload.version_code = bumpedCode;
      payload.aab_version_code = bumpedCode;
      if (versionName && /^\d+$/.test(versionName)) {
        payload.version_name = String(parseInt(versionName, 10) + 1);
      } else if (versionName) {
        payload.version_name = versionName + ".1";
      }
      if (!isNaN(aabVersionCode) && aabVersionCode <= latest) {
        if (aabVersionName && /^\d+$/.test(aabVersionName)) {
          payload.aab_version_name = String(parseInt(aabVersionName, 10) + 1);
        } else if (aabVersionName) {
          payload.aab_version_name = aabVersionName + ".1";
        }
      }
    }
  } catch (err) {
    console.error("Version bump check failed:", err && err.message);
  }
  return payload;
}

function normalizePng(value) {
  const raw = safeString(value);
  if (!raw) return null;

  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length < 33 || buffer.subarray(0, 8).toString("hex") !== PNG_MAGIC) {
    const error = new Error("Selected icon must be a PNG image.");
    error.statusCode = 400;
    throw error;
  }

  if (buffer.length > 2_500_000) {
    const error = new Error("Selected icon PNG is too large. Use a PNG below 2.5 MB.");
    error.statusCode = 413;
    throw error;
  }

  // Validate IHDR chunk to ensure the PNG has reasonable dimensions
  // (prevents corrupted/truncated PNGs that pass the magic-byte check)
  const ihdrType = buffer.toString("ascii", 12, 16);
  if (ihdrType !== "IHDR" || buffer.readUInt32BE(8) !== 13) {
    const error = new Error("Selected icon PNG has a corrupted or missing header (IHDR).");
    error.statusCode = 400;
    throw error;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 48 || height < 48) {
    const error = new Error(`Selected icon PNG is too small (${width}x${height}). Minimum is 48x48 pixels.`);
    error.statusCode = 400;
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

async function commitIconToCiCd({ requestId, packageName, buffer }) {
  // eslint-disable-next-line no-console
  console.log(`commitIconToCiCd: writing builds/icons/${requestId}.png + builds/icons/${packageName}.png (${buffer.length} bytes)`);
  const ciRepo = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciRef = process.env.CI_REF || "main";
  // `requestId` already starts with "builder-" (e.g. "builder-<hash>"),
  // so the file must be builds/icons/<requestId>.png to match the site
  // card fallback (builder.js builds builds/icons/builder-<hash>.png from
  // the run title). Prepending another "builder-" previously produced a
  // mismatched path and the card never found the icon.
  // We ALSO write builds/icons/<packageName>.png so the ci-cd icon
  // catalog is complete and keyed by package (one source of truth per game).
  const paths = [`builds/icons/${requestId}.png`];
  if (packageName) paths.push(`builds/icons/${packageName}.png`);
  const content = buffer.toString("base64");

  // Use the Git Data API (blob -> tree -> commit -> ref) instead of the
  // Contents API. The Contents API rejects files larger than 1 MB, but a
  // launcher icon can be ~2.5 MB base64. The Data API handles blobs up
  // to 100 MB.
  //
  // Builds are dispatched concurrently, so several icon commits race on the
  // same ci-cd branch and the final PATCH ref frequently fails with HTTP 409
  // ("ref moved"). Without a retry the commit is dropped and — because large
  // icons cannot be inlined into the workflow_dispatch input — the user icon
  // silently never reaches the build. Retry the whole sequence (re-reading
  // the current ref each time) so the icon reliably lands.
  const maxAttempts = 8;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const blob = await githubFetch(`/repos/${ciRepo}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, encoding: "base64" })
      });

      const ref = await githubFetch(`/repos/${ciRepo}/git/refs/heads/${encodeURIComponent(ciRef)}`);
      const baseCommitSha = ref.object.sha;
      const baseCommit = await githubFetch(`/repos/${ciRepo}/git/commits/${baseCommitSha}`);
      const baseTreeSha = baseCommit.tree.sha;

      const tree = await githubFetch(`/repos/${ciRepo}/git/trees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: paths.map((p) => ({ path: p, mode: "100644", type: "blob", sha: blob.sha }))
        })
      });

      const commit = await githubFetch(`/repos/${ciRepo}/git/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Android builder icon for ${requestId}`,
          tree: tree.sha,
          parents: [baseCommitSha]
        })
      });

      await githubFetch(`/repos/${ciRepo}/git/refs/heads/${encodeURIComponent(ciRef)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha })
      });

      // eslint-disable-next-line no-console
      console.log(`commitIconToCiCd: OK -> ${paths.join(", ")}`);
      // Return the canonical repo-relative path (by package when available,
      // else by requestId). The build workflow checks out ci-cd at the
      // workspace root, so it reads the icon straight from its own checkout —
      // no CDN round-trip and, most importantly, NO base64 inlining. GitHub
      // truncates large workflow_dispatch string inputs, so inlining the icon
      // as base64 produced a half-written (corrupt / radial-gradient) PNG.
      // Copying the committed file is exact.
      return packageName ? `builds/icons/${packageName}.png` : `builds/icons/${requestId}.png`;
    } catch (err) {
      lastErr = err;
      const code = err.statusCode;
      const retryable = !code || code === 409 || code === 429 || code === 502 || code === 503;
      if (!retryable || attempt === maxAttempts) break;
      const backoff = Math.min(2000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr || new Error("commitIconToCiCd failed");
}

async function commitIconToSite({ packageName, buffer }) {
  // eslint-disable-next-line no-console
  console.log(`commitIconToSite: writing icons/${packageName}.png + repo-icons/${packageName}.png (${buffer.length} bytes)`);
  const siteRepo = process.env.SITE_REPOSITORY || "zey-win/zey-win.github.io";
  const siteRef = process.env.SITE_REF || "main";
  const content = buffer.toString("base64");

  const maxAttempts = 5;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const blob = await githubFetch(`/repos/${siteRepo}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, encoding: "base64" })
      });

      const ref = await githubFetch(`/repos/${siteRepo}/git/refs/heads/${encodeURIComponent(siteRef)}`);
      const baseCommitSha = ref.object.sha;
      const baseCommit = await githubFetch(`/repos/${siteRepo}/git/commits/${baseCommitSha}`);
      const baseTreeSha = baseCommit.tree.sha;

      // Write the icon to BOTH locations: icons/ (used by the build workflow)
      // and repo-icons/ (used by the public site cards). The uploaded icon from
      // the builder popup lands in the site repo automatically.
      const tree = await githubFetch(`/repos/${siteRepo}/git/trees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [
            { path: `icons/${packageName}.png`, mode: "100644", type: "blob", sha: blob.sha },
            { path: `repo-icons/${packageName}.png`, mode: "100644", type: "blob", sha: blob.sha }
          ]
        })
      });

      const commit = await githubFetch(`/repos/${siteRepo}/git/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Update icon for ${packageName}`,
          tree: tree.sha,
          parents: [baseCommitSha]
        })
      });

      await githubFetch(`/repos/${siteRepo}/git/refs/heads/${encodeURIComponent(siteRef)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha })
      });

      // eslint-disable-next-line no-console
      console.log(`commitIconToSite: OK -> https://zey-win.github.io/icons/${packageName}.png + repo-icons/${packageName}.png`);
      return { path: `icons/${packageName}.png`, url: `https://zey-win.github.io/icons/${packageName}.png` };
    } catch (err) {
      lastErr = err;
      const code = err.statusCode;
      const retryable = !code || code === 409 || code === 429 || code === 502 || code === 503;
      if (!retryable || attempt === maxAttempts) break;
      const backoff = Math.min(2000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr || new Error("commitIconToSite failed");
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
    icon_png_path: iconPath || safeString(payload.icon_png_path) || safeString(payload.icon_url),
    icon_png_base64: safeString(payload.icon_png_base64),
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
    firebase_json_base64: safeString(payload.firebase_json_base64)
  };

  return Object.fromEntries(WORKFLOW_INPUT_KEYS.map((key) => [key, inputs[key] || ""]));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchWorkflow(inputs, mode) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const isAdmin = String(mode || "").toLowerCase() === "admin";
  const ciWorkflow = isAdmin ? "build-apk.yml" : "build-site.yml";
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

async function findWorkflowRun({ requestId, createdAfter, mode }) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const isAdmin = String(mode || "").toLowerCase() === "admin";
  const ciWorkflow = isAdmin ? "build-apk.yml" : "build-site.yml";
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
    const buildMode = safeString(payload.mode, "main");
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
    const ICON_INLINE_LIMIT = 40000;

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

    // Commit the icon to ci-cd (builds/icons/builder-<id>.png) so the
    // builder site card can render it (the card reads that path, since
    // /api/runs does not return an inline iconUrl). commitIconToCiCd uses
    // the Git Data API, which handles icons of any size, so we always
    // commit. As a fallback we still inline the base64 when the commit
    // fails and the icon is small enough for the workflow_dispatch input limit.
    let iconPngBase64 = "";
    let iconPngPath = "";
    const iconRaw = payload.icon_png_base64 || payload.iconDataUrl || "";
    if (iconRaw && !iconRaw.startsWith("http")) {
      const iconBuffer = normalizePng(iconRaw);
      if (iconBuffer) {
        try {
          iconPngPath = await commitIconToCiCd({ requestId, packageName, buffer: iconBuffer });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Icon commit failed:", err && err.message);
          const encoded = iconBuffer.toString("base64");
          if (encoded.length < ICON_INLINE_LIMIT) {
            iconPngBase64 = encoded;
          }
        }
        // Commit base64 JSON to site repo for step 45 to fetch
        try {
          await commitIconToSite({ packageName, buffer: iconBuffer });
          // eslint-disable-next-line no-console
          console.log(`Icon committed to site: icons/${packageName}.png`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Icon site commit failed:", err && err.message);
        }
      }
    }

    await bumpVersionIfNeeded(payload);
    const inputs = buildWorkflowInputs(
      {
        ...payload,
        builder_request_id: requestId,
        game_repository: gameRepository,
        game_ref: gameRef,
        firebase_json_base64: firebaseBase64,
        icon_png_base64: iconPngBase64,
        icon_png_path: iconPngPath
      },
      iconPngPath || iconPath
    );

    if (!iconResult && iconRaw) {
      iconResult = { dataUrl: iconRaw.startsWith("data:") ? iconRaw : `data:image/png;base64,${iconRaw}` };
    }

    const dispatchStartedAt = new Date();
    // eslint-disable-next-line no-console
    console.log(`[build] icon source: raw=${iconRaw ? "yes" : "no"}, iconPngPath=${iconPngPath || "(none)"}, dispatch icon_png_path=${inputs.icon_png_path || "(empty)"}`);
    const ciWorkflowForMode = String(buildMode || "").toLowerCase() === "admin"
      ? "build-apk.yml"
      : "build-site.yml";
    const dispatch = await dispatchWorkflow(inputs, buildMode);
    const run = await findWorkflowRun({ requestId, createdAfter: dispatchStartedAt, mode: buildMode });

    // Record build in centralized DB (/api/configs = db.json)
    try {
      const db = require("./configs");
      const dataState = await db.loadDb();
      const data = dataState.db;
      const sha = dataState.sha;
      data.builds.push({
        run_id: run ? run.id : null,
        request_id: requestId,
        package_name: packageName,
        app_name: appName,
        game_repository: gameRepository,
        build_format: inputs.build_format,
        version_name: inputs.aab_version_name || inputs.version_name,
        version_code: inputs.aab_version_code || inputs.version_code,
        status: "queued",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if (iconPngBase64) {
        const idx = data.icons.findIndex((i) => i.package_name === packageName);
        const iconEntry = { package_name: packageName, icon_data_url: `data:image/png;base64,${iconPngBase64}`, icon_base64: iconPngBase64, updated_at: new Date().toISOString() };
        if (idx >= 0) data.icons[idx] = iconEntry;
        else data.icons.push(iconEntry);
      }
      await db.saveDb(data, sha);
    } catch (_e) { /* non-critical */ }

    // Persist non-secret inputs so the builder site can show launch parameters
    // for any run (not just those submitted from the same browser).
    if (run && run.id) {
      try {
        await saveBuildInputs(run.id, inputs);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to persist build inputs:", err && err.message);
      }
    }

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
