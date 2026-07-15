const {
  errorPayload,
  handleOptions,
  loadAllBuildInputs,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

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
    const inputs = all[runId] || null;

    sendJson(req, res, 200, { ok: true, runId, inputs });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
