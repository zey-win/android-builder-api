const {
  errorPayload,
  githubFetch,
  handleOptions,
  safeString,
  sendJson
} = require("./_shared");

const CI_CD_REPO = "zey-win/ci-cd";

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    const url = new URL(req.url, "http://localhost");
    const runId = safeString(url.searchParams.get("run_id"));

    if (!runId || !/^\d+$/.test(runId)) {
      sendJson(req, res, 400, { ok: false, error: "run_id is required" });
      return;
    }

    const jobs = await githubFetch(`/repos/${CI_CD_REPO}/actions/runs/${runId}/jobs`);
    if (!jobs || !jobs.jobs || !jobs.jobs.length) {
      sendJson(req, res, 404, { ok: false, error: "No jobs found for this run" });
      return;
    }

    const firstJob = jobs.jobs[0];
    const logText = await githubFetch(`/repos/${CI_CD_REPO}/actions/jobs/${firstJob.id}/logs`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 200;
    res.end(typeof logText === "string" ? logText : JSON.stringify(logText));
  } catch (err) {
    sendJson(req, res, 500, errorPayload(err));
  }
};
