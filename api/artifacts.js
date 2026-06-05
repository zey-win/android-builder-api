const {
  errorPayload,
  githubFetch,
  handleOptions,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

function parseBuildTxt(text) {
  return Object.fromEntries(
    String(text || "")
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
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

    if (!/^[A-Za-z0-9_.-]+$/.test(packageName)) {
      sendJson(req, res, 400, { ok: false, error: "package_name is required." });
      return;
    }

    const path = `builds/${packageName}/latest-build.txt`;
    let file = null;
    try {
      file = await githubFetch(`/repos/${ciRepository}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=main`);
    } catch (error) {
      if (error.statusCode === 404) {
        sendJson(req, res, 200, { ok: true, ready: false, packageName });
        return;
      }
      throw error;
    }

    const meta = parseBuildTxt(Buffer.from(file.content || "", "base64").toString("utf8"));
    const versionCode = Number(meta.version_code || 0);
    const ready = versionCode > 0 && versionCode >= minVersionCode;
    const format = (meta.build_format || "apk").toLowerCase();
    const type = format === "apk_aab" ? "APK+AAB" : format === "aab" ? "AAB" : "APK";

    sendJson(req, res, 200, {
      ok: true,
      ready,
      packageName,
      artifact: ready
        ? {
            type,
            versionName: meta.version_name || "",
            versionCode: meta.version_code || "",
            releaseUrl: meta.github_release || meta.apk_release || "",
            assetName: meta.package_assets || meta.aab_asset || meta.apk_asset || "",
            repoPath: meta.package_repo_paths || meta.aab_path || meta.apk_path || meta.package_repo_path || "",
            apkAsset: meta.apk_asset || "",
            apkPath: meta.apk_path || "",
            aabAsset: meta.aab_asset || "",
            aabPath: meta.aab_path || "",
            builtAt: meta.built_at_utc || ""
          }
        : null
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
