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
        inputs = {
          game_repository: "zey-win/plinko",
          game_ref: "main",
          package_name: pkg,
          app_name: app,
          build_format: fmt || "apk_aab",
          version_name: run.versionName || "",
          version_code: run.versionCode || "",
          aab_version_name: run.versionName || "",
          aab_version_code: run.versionCode || "",
          fast_build: "false",
          signing_profile: "playmax",
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
