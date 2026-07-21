const {
  errorPayload,
  githubFetch,
  handleOptions,
  safeString,
  sendJson
} = require("../lib/shared");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    const runId = safeString(req.query?.run_id);
    if (!runId || !/^\d+$/.test(runId)) {
      sendJson(req, res, 400, { ok: false, error: "Missing or invalid run_id" });
      return;
    }

    const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
    const data = await githubFetch(`/repos/${ciRepository}/actions/runs/${runId}`);

    const inputs = data.event?.inputs || {};

    sendJson(req, res, 200, { ok: true, inputs });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
