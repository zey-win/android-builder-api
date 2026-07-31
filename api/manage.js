const {
   errorPayload,
   githubFetch,
   handleOptions,
   readJson,
   requireOperator,
   safeString,
   sendJson,
   addHiddenBuild,
   pinRun,
   unpinRun,
   loadHiddenBuilds
 } = require("../lib/shared");
 const { loadDb, saveDb } = require("./configs");

async function handleCancel(req, res) {
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

  sendJson(req, res, 200, { ok: true, runId, cancelled: true });
}

async function handleDelete(req, res) {
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

  if (runId) {
    try {
      const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
      await githubFetch(`/repos/${ciRepository}/actions/runs/${runId}/cancel`, {
        method: "POST"
      });
    } catch (cancelErr) {
      console.error("Failed to cancel workflow run:", cancelErr && cancelErr.message);
    }
  }

  await addHiddenBuild({ requestId, runId });

  try {
    const { db, sha } = await loadDb();
    const before = db.builds.length;
    if (runId) {
      db.builds = db.builds.filter((b) => String(b.run_id) !== runId);
    }
    if (requestId) {
      db.builds = db.builds.filter((b) => b.request_id !== requestId);
    }
    if (db.builds.length < before) {
      await saveDb(db, sha);
    }
  } catch (dbErr) {
    console.error("Failed to delete build from db.json:", dbErr && dbErr.message);
  }

  sendJson(req, res, 200, {
    ok: true,
    deleted: true,
    requestId: requestId || undefined,
    runId: runId || undefined
  });
}

async function handlePinRun(req, res) {
  const body = await readJson(req, 32_000);
  const runId = safeString(body.runId || body.run_id);
  if (!/^\d+$/.test(runId)) {
    const error = new Error("runId is required.");
    error.statusCode = 400;
    throw error;
  }
  await pinRun(runId);
  sendJson(req, res, 200, { ok: true, runId, pinned: true });
}

async function handleUnpinRun(req, res) {
  const body = await readJson(req, 32_000);
  const runId = safeString(body.runId || body.run_id);
  if (!/^\d+$/.test(runId)) {
    const error = new Error("runId is required.");
    error.statusCode = 400;
    throw error;
  }
  await unpinRun(runId);
  sendJson(req, res, 200, { ok: true, runId, pinned: false });
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "POST") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const path = String(req.url || "").split("?")[0];
    if (path.endsWith("/cancel")) {
      return await handleCancel(req, res);
    }
    if (path.endsWith("/delete")) {
      return await handleDelete(req, res);
    }
    if (path.endsWith("/pin-run")) {
      return await handlePinRun(req, res);
    }
    if (path.endsWith("/unpin-run")) {
      return await handleUnpinRun(req, res);
    }

    sendJson(req, res, 404, { ok: false, error: "Unknown manage action." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
