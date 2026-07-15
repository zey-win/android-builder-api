const {
  errorPayload,
  githubFetch,
  handleOptions,
  loadHiddenBuilds,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

// Releases in ci-cd are tagged `android-<runNumber>-<runAttempt>` and their
// title contains the version code (e.g. "APK com.x v12"). We use that to show
// version info on build cards for ANY historical run (no stored metadata needed).
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
    // eslint-disable-next-line no-console
    console.error("Failed to load releases for version map", err && err.message);
  }
  releasesCache = { ts: now, map };
  return map;
}

function versionFromRelease(run, releasesMap) {
  const tag = `android-${run.run_number}-${run.run_attempt}`;
  const rel = releasesMap[tag];
  if (!rel) return null;
  const code = rel.code;
  return { versionName: `1.0.${code}`, versionCode: code };
}

function attachVersion(run, version) {
  if (!version) return run;
  run.versionName = version.versionName;
  run.versionCode = version.versionCode;
  return run;
}

async function findByRequestId(requestId) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  const data = await githubFetch(
    `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=100`
  );

  const run = (data.workflow_runs || []).find((item) => {
    const title = `${item.display_title || ""} ${item.name || ""}`;
    return title.includes(requestId);
  });

  if (!run) {
    return null;
  }

  const mapped = {
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
  const releasesMap = await getReleasesVersionMap();
  return attachVersion(mapped, versionFromRelease(mapped, releasesMap));
}

async function listRecentRuns() {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  const data = await githubFetch(
    `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=100`
  );

  const hidden = await loadHiddenBuilds();
  const releasesMap = await getReleasesVersionMap();

  const filtered = (data.workflow_runs || [])
    .filter((run) => {
      const title = `${run.display_title || ""} ${run.name || ""}`;
      const byRequest = hidden.hiddenRequestIds.some((req) => req && title.includes(req));
      const byRun = hidden.hiddenRunIds.includes(String(run.id));
      return !byRequest && !byRun;
    })
    .slice(0, 50);

  return filtered.map((run) => {
    const mapped = {
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
    return attachVersion(mapped, versionFromRelease(mapped, releasesMap));
  });
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    requireOperator(req);

    let requestId = safeString(req.query?.request_id);
    if (req.method === "POST") {
      const body = await readJson(req, 100_000);
      requestId = safeString(body.request_id || requestId);
    }

    if (!requestId) {
      const runs = await listRecentRuns();
      sendJson(req, res, 200, { ok: true, runs });
      return;
    }

    const run = await findByRequestId(requestId);
    sendJson(req, res, 200, { ok: true, requestId, run });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
