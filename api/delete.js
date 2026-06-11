const {
  errorPayload,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson,
  addHiddenBuild
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

    const requestId = safeString(
      body.request_id || body.requestId || body.builder_request_id || body.id
    );
    const runId = safeString(body.run_id || body.runId || body.database_id || body.runNumber);

    if (!requestId && !runId) {
      const error = new Error("request_id or run_id is required to delete/hide a build card.");
      error.statusCode = 400;
      throw error;
    }

    await addHiddenBuild({ requestId, runId });

    sendJson(req, res, 200, {
      ok: true,
      deleted: true,
      requestId: requestId || undefined,
      runId: runId || undefined
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
