const {
  errorPayload,
  githubFetch,
  handleOptions,
  loadAllBuildInputs,
  requireOperator,
  safeString,
  sendJson
} = require("../lib/shared");

function parseDisplayTitle(title) {
  if (!title) return { app: "", pkg: "", fmt: "" };
  const clean = title.replace(/^Android:\s*/i, "");
  const parts = clean.split(" / ").map(p => p.trim());
  return {
    app: parts[0] || "",
    pkg: parts[1] || "",
    fmt: parts[2] || ""
  };
}

let releasesCache = { ts: 0, map: null };
const RELEASES_TTL = 5 * 60 * 1000;

async function getReleasesVersionMap() {
  const now = Date.now();
  if (releasesCache.map && now - releasesCache.ts < RELEASES_TTL) {
    return releasesCache.map;
  }
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const map = {};
  try {
    const data = await githubFetch(`/repos/${ciRepository}/releases?per_page=100`);
    const releases = Array.isArray(data) ? data : (data && data.items) || [];
    for (const rel of releases) {
      const m = (rel.name || "").match(/v(\d+)/);
      if (m && rel.tag_name) {
        map[rel.tag_name] = { code: m[1], name: rel.name };
      }
    }
  } catch (err) {
    console.error("Failed to load releases for version map", err && err.message);
  }
  releasesCache = { ts: now, map };
  return map;
}

async function fetchRunFromGitHub(runId) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  const data = await githubFetch(
    `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=100`
  );
  const run = (data.workflow_runs || []).find(r => String(r.id) === String(runId));
  if (!run) return null;
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

function versionFromRelease(run, releasesMap) {
  const tag = `android-${run.runNumber}-${run.runAttempt}`;
  const rel = releasesMap[tag];
  if (!rel) return null;
  const code = rel.code;
  return { versionName: `1.0.${code}`, versionCode: code };
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    requireOperator(req);

    const runId = safeString(req.query?.run_id);
    if (!runId) {
      sendJson(req, res, 400, { ok: false, error: "run_id is required" });
      return;
    }

    const all = await loadAllBuildInputs();
    let inputs = all[runId] || null;

    if (!inputs) {
      const run = await fetchRunFromGitHub(runId);
      if (run) {
        const { app, pkg, fmt } = parseDisplayTitle(run.displayTitle);
        const releasesMap = await getReleasesVersionMap();
        const version = versionFromRelease(run, releasesMap);
        inputs = {
          game_repository: "zey-win/plinko",
          game_ref: "main",
          package_name: pkg,
          app_name: app,
          build_format: fmt || "apk_aab",
          version_name: version?.versionName || "",
          version_code: version?.versionCode || "",
          aab_version_name: version?.versionName || "",
          aab_version_code: version?.versionCode || "",
          fast_build: "false",
          signing_profile: "slotspot",
          zeywin_sdk_version: "v3.9.37",
          version_mode: "auto_next"
        };
      }
    }

    sendJson(req, res, 200, { ok: true, runId, inputs });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};