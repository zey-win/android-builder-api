const { 
  errorPayload, 
  githubFetch, 
  handleOptions, 
  safeString, 
  sendJson 
} = require("./_shared");

const CI_REPO = process.env.CI_REPOSITORY || "zey-win/ci-cd";
const CI_WORKFLOW = process.env.CI_WORKFLOW || "build-apk.yml";

const DB_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const DB_PATH = "db.json";

function normalizeTag(tag) {
  const raw = safeString(tag);
  if (!raw) return "";
  return raw.startsWith("v") ? raw : `v${raw}`;
}

function compareTagsAsc(left, right) {
  const parse = (value) => normalizeTag(value).replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function loadLatestBuildFromCiCd(packageName) {
  try {
    const url = `https://raw.githubusercontent.com/${CI_REPO}/main/builds/${encodeURIComponent(packageName)}/latest-build.txt`;
    const raw = await fetch(url);
    if (!raw.ok) return null;
    const text = await raw.text();
    const mName = text.match(/^version_name=(.+)$/m);
    const mCode = text.match(/^version_code=(.+)$/m);
    if (!mCode) return null;
    const code = parseInt(mCode[1], 10);
    return {
      code: isNaN(code) ? null : code,
      name: mName ? mName[1].trim() : ""
    };
  } catch {
    return null;
  }
}

async function countWorkflowRuns(packageName) {
  try {
    const data = await githubFetch(
      `/repos/${CI_REPO}/actions/workflows/${encodeURIComponent(CI_WORKFLOW)}/runs?event=workflow_dispatch&per_page=50`
    );
    const workflowRuns = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    return workflowRuns.filter(run => {
      const title = `${run.display_title || ''} ${run.name || ''}`;
      return title.includes(packageName);
    }).length;
  } catch {
    return 0;
  }
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    const url = new URL(req.url, "http://localhost");
    
    // Handle SDK versions endpoint
    if (url.pathname === "/api/sdk-versions") {
      if (req.method !== "GET") {
        sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
        return;
      }

      const repository = safeString(req.query?.repository, "zey-win/ZeyWinAdsSDK-Unity");
      const minVersion = normalizeTag(req.query?.min_version, "v3.9.37");

      const response = await githubFetch(`/repos/${repository}/tags?per_page=100`);
      const tags = (Array.isArray(response) ? response : [])
        .map((entry) => normalizeTag(entry?.name))
        .filter(Boolean)
        .filter((tag) => compareTagsAsc(tag, minVersion) >= 0)
        .sort((left, right) => compareTagsAsc(right, left));

      const versions = tags.length ? tags : [minVersion];
      sendJson(req, res, 200, {
        ok: true,
        repository,
        minVersion,
        versions,
        defaultVersion: versions[0] || minVersion
      });
      return;
    }
    
    // Handle versions endpoint
    const packageName = safeString(url.searchParams.get("package_name"));
    if (!packageName) {
      sendJson(req, res, 400, { ok: false, error: "package_name is required" });
      return;
    }

    // Fast path: check latest-build.txt in ci-cd repo
    const latestBuild = await loadLatestBuildFromCiCd(packageName);
    
    let nextCode;
    let versionName;
    
    if (latestBuild && latestBuild.code > 0) {
      nextCode = latestBuild.code + 1;
      versionName = latestBuild.name || String(nextCode);
      if (!/^\d+/.test(versionName)) versionName = String(nextCode);
    } else {
      const runCount = await countWorkflowRuns(packageName);
      if (runCount > 0) {
        nextCode = runCount + 1;
      } else {
        nextCode = 1;
      }
      versionName = String(nextCode);
    }
    
    const versionCode = String(nextCode);

    var fmt = "apk_aab";
    var aab = fmt.includes("aab") ? { versionName, versionCode } : {};
    var apk = fmt.includes("apk") ? { versionName, versionCode } : {};

    sendJson(req, res, 200, {
      ok: true,
      package_name: packageName,
      aab,
      apk,
      versionName,
      versionCode,
      candidates: latestBuild ? [{
        versionName: latestBuild.name,
        versionCode: String(latestBuild.code),
        source: "ci-cd"
      }] : []
    });
  } catch (err) {
    sendJson(req, res, 500, errorPayload(err));
  }
};
