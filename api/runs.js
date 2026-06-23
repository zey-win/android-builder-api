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

  return {
    id: run.id,
    runNumber: run.run_number,
    runAttempt: run.run_attempt,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
    displayTitle: run.display_title || run.name,
    requestId,
    iconUrl: buildIconUrl(requestId)
  };
}

function extractRequestId(title) {
  const match = String(title || "").match(/builder-([a-z0-9]+)/);
  return match ? match[1] : null;
}

function buildIconUrl(requestId) {
  if (!requestId) return null;
  return `https://raw.githubusercontent.com/zey-win/ci-cd/main/builds/icons/${requestId}.png`;
}

async function listRecentRuns() {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  const data = await githubFetch(
    `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=100`
  );

  const hidden = await loadHiddenBuilds();

  const filtered = (data.workflow_runs || [])
    .filter((run) => {
      const title = `${run.display_title || ""} ${run.name || ""}`;
      const byRequest = hidden.hiddenRequestIds.some((req) => req && title.includes(req));
      const byRun = hidden.hiddenRunIds.includes(String(run.id));
      return !byRequest && !byRun;
    })
    .slice(0, 50);

  return filtered.map((run) => {
    const title = `${run.display_title || ""} ${run.name || ""}`;
    const requestId = extractRequestId(title);
    return {
    id: run.id,
    runNumber: run.run_number,
    runAttempt: run.run_attempt,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
    displayTitle: run.display_title || run.name,
    requestId,
    iconUrl: buildIconUrl(requestId)
  };
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
// force redeploy
