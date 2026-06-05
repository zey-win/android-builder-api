const {
  errorPayload,
  githubFetch,
  handleOptions,
  parseKeyValueText,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

function nextVersionName(latestName, latestCode) {
  const name = safeString(latestName);
  const match = name.match(/^(.*?)(\d+)$/);
  if (!match) {
    return `1.0.${latestCode + 1}`;
  }
  return `${match[1]}${Number(match[2]) + 1}`;
}

async function readBuildTxt(ciRepository, path) {
  const file = await githubFetch(`/repos/${ciRepository}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=main`);
  return parseKeyValueText(Buffer.from(file.content || "", "base64").toString("utf8"));
}

async function findLatestBuild(ciRepository, packageName) {
  const packagePath = `builds/${packageName}`;
  let latest = null;

  try {
    latest = await readBuildTxt(ciRepository, `${packagePath}/latest-build.txt`);
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  let maxCode = Number(latest?.version_code || 0);
  let maxMeta = latest;

  try {
    const entries = await githubFetch(`/repos/${ciRepository}/contents/${encodeURIComponent(packagePath).replaceAll("%2F", "/")}?ref=main`);
    const versionDirs = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry.type === "dir" && /^v\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.slice(1)))
      .filter((code) => Number.isInteger(code) && code > 0)
      .sort((a, b) => b - a);

    if (versionDirs[0] && versionDirs[0] > maxCode) {
      maxCode = versionDirs[0];
      try {
        maxMeta = await readBuildTxt(ciRepository, `${packagePath}/v${maxCode}/build.txt`);
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }
    }
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  return {
    versionName: maxMeta?.version_name || "",
    versionCode: maxCode || 0,
    buildFormat: maxMeta?.build_format || "",
    releaseUrl: maxMeta?.github_release || maxMeta?.apk_release || "",
    builtAt: maxMeta?.built_at_utc || ""
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

    if (!/^[A-Za-z0-9_.-]+$/.test(packageName)) {
      sendJson(req, res, 400, { ok: false, error: "package_name is required." });
      return;
    }

    const latest = await findLatestBuild(ciRepository, packageName);
    const nextCode = Math.max(1, Number(latest.versionCode || 0) + 1);

    sendJson(req, res, 200, {
      ok: true,
      packageName,
      latest,
      apk: {
        versionName: "1",
        versionCode: "1"
      },
      aab: {
        versionName: latest.versionName ? nextVersionName(latest.versionName, latest.versionCode) : "1.0.1",
        versionCode: String(nextCode)
      }
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
