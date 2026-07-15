const {
  buildReleaseAssetLinks,
  errorPayload,
  githubFetch,
  handleOptions,
  parseKeyValueText,
  requireOperator,
  safeString,
  sendJson
} = require("../lib/shared");

function encodeContentPath(path) {
  return encodeURIComponent(path).replaceAll("%2F", "/");
}

async function readBuildMeta(ciRepository, path) {
  const file = await githubFetch(`/repos/${ciRepository}/contents/${encodeContentPath(path)}?ref=main`);
  return parseKeyValueText(Buffer.from(file.content || "", "base64").toString("utf8"));
}

async function findBuildByRequestId(ciRepository, packageName, requestId) {
  const packagePath = `builds/${packageName}`;
  const entries = await githubFetch(`/repos/${ciRepository}/contents/${encodeContentPath(packagePath)}?ref=main`);
  const versionDirs = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry.type === "dir" && /^v\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.slice(1)))
    .filter((code) => Number.isInteger(code) && code > 0)
    .sort((a, b) => b - a);

  for (const code of versionDirs) {
    try {
      const meta = await readBuildMeta(ciRepository, `${packagePath}/v${code}/build.txt`);
      if (meta.builder_request_id === requestId) {
        return meta;
      }
    } catch (error) {
      if (error.statusCode !== 404) {
        throw error;
      }
    }
  }

  return null;
}

function artifactPayload(meta) {
  const format = (meta.build_format || "apk").toLowerCase();
  const type = format === "apk_aab" ? "APK+AAB" : format === "aab" ? "AAB" : "APK";
  const assets = buildReleaseAssetLinks(meta);
  const apkDownload = assets.find((asset) => asset.type === "APK")?.downloadUrl || "";
  const aabDownload = assets.find((asset) => asset.type === "AAB")?.downloadUrl || "";

  return {
    type,
    versionName: meta.version_name || "",
    versionCode: meta.version_code || "",
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
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
    const packageName = safeString(req.query?.package_name);
    const minVersionCode = Number(safeString(req.query?.min_version_code, "0"));
    const requestId = safeString(req.query?.builder_request_id);

    if (!/^[A-Za-z0-9_.-]+$/.test(packageName)) {
      sendJson(req, res, 400, { ok: false, error: "package_name is required." });
      return;
    }

    if (requestId && !/^[A-Za-z0-9_.:-]+$/.test(requestId)) {
      sendJson(req, res, 400, { ok: false, error: "builder_request_id is invalid." });
      return;
    }

    let meta = null;
    try {
      meta = requestId
        ? await findBuildByRequestId(ciRepository, packageName, requestId)
        : await readBuildMeta(ciRepository, `builds/${packageName}/latest-build.txt`);
    } catch (error) {
      if (error.statusCode === 404) {
        sendJson(req, res, 200, { ok: true, ready: false, packageName, requestId });
        return;
      }
      throw error;
    }

    if (!meta) {
      sendJson(req, res, 200, { ok: true, ready: false, packageName, requestId });
      return;
    }

    const versionCode = Number(meta.version_code || 0);
    const ready = versionCode > 0 && versionCode >= minVersionCode;

    sendJson(req, res, 200, {
      ok: true,
      ready,
      packageName,
      requestId,
      artifact: ready ? artifactPayload(meta) : null
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
