const {
  errorPayload,
  githubFetch,
  handleOptions,
  requireOperator,
  safeString,
  sendJson
} = require("../lib/shared");

function tailLines(text, count = 180) {
  return String(text || "")
    .split(/\r?\n/)
    .slice(-count)
    .join("\n");
}

async function githubText(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    const error = new Error("Server is missing GITHUB_TOKEN.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "zeywin-android-builder-api",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || `GitHub log request failed: ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return response.text();
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
    const runId = safeString(req.query?.run_id);
    if (!/^[0-9]+$/.test(runId)) {
      sendJson(req, res, 400, { ok: false, error: "run_id is required." });
      return;
    }

    const run = await githubFetch(`/repos/${ciRepository}/actions/runs/${runId}`);
    const jobsData = await githubFetch(`/repos/${ciRepository}/actions/runs/${runId}/jobs?per_page=20`);
    const jobs = [];

    for (const job of jobsData.jobs || []) {
      let logTail = "";
      try {
        logTail = tailLines(await githubText(`/repos/${ciRepository}/actions/jobs/${job.id}/logs`));
      } catch (error) {
        logTail = error.statusCode === 404 ? "Логи этого job ещё не готовы." : `Не удалось получить лог: ${error.message}`;
      }

      jobs.push({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        htmlUrl: job.html_url,
        logTail
      });
    }

    sendJson(req, res, 200, {
      ok: true,
      run: {
        id: run.id,
        runNumber: run.run_number,
        runAttempt: run.run_attempt,
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url,
        displayTitle: run.display_title || run.name,
        createdAt: run.created_at,
        updatedAt: run.updated_at
      },
      jobs
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
