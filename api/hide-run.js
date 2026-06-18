const {
  errorPayload,
  githubFetch,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

const HIDDEN_FILE_REPO = "zey-win/android-builder-api";
const HIDDEN_FILE_PATH = "data/hidden-runs.json";

async function loadHidden() {
  try {
    const data = await githubFetch(`/repos/${HIDDEN_FILE_REPO}/contents/${HIDDEN_FILE_PATH}`);
    if (data && data.content) {
      const text = Buffer.from(data.content, "base64").toString("utf8");
      const parsed = JSON.parse(text);
      return { runIds: Array.isArray(parsed.runIds) ? parsed.runIds.map(String) : [], sha: data.sha };
    }
  } catch (err) {
    if (err.statusCode !== 404) console.error("Failed to load hidden runs", err.message);
  }
  return { runIds: [], sha: null };
}

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

    const { runIds, sha } = await loadHidden();
    if (!runIds.includes(runId)) runIds.push(runId);

    const contentObj = { runIds, updatedAt: new Date().toISOString() };
    const content = Buffer.from(JSON.stringify(contentObj, null, 2)).toString("base64");

    const writeBody = {
      message: `hide run ${runId}`,
      content,
      ...(sha ? { sha } : {})
    };

    await githubFetch(`/repos/${HIDDEN_FILE_REPO}/contents/${HIDDEN_FILE_PATH}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(writeBody)
    });

    sendJson(req, res, 200, { ok: true, runId, hidden: true });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};