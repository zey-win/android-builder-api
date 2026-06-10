const {
  errorPayload,
  githubFetch,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "POST") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);
    const body = await readJson(req, 32_000);
    const runId = safeString(body.run_id || body.runId);
    if (!/^\d+$/.test(runId)) {
      const error = new Error("run_id is required.");
      error.statusCode = 400;
      throw error;
    }

    const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
    await githubFetch(`/repos/${ciRepository}/actions/runs/${runId}/cancel`, {
      method: "POST"
    });

    sendJson(req, res, 200, {
      ok: true,
      runId,
      cancelled: true
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
