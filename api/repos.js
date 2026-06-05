const {
  errorPayload,
  getAllowedRepos,
  githubFetch,
  handleOptions,
  requireOperator,
  sendJson
} = require("./_shared");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const repos = [];
    for (const repo of getAllowedRepos()) {
      const data = await githubFetch(`/repos/${repo}`);
      repos.push({
        fullName: data.full_name,
        name: data.name,
        owner: data.owner?.login,
        private: data.private,
        defaultBranch: data.default_branch,
        htmlUrl: data.html_url
      });
    }

    sendJson(req, res, 200, { ok: true, repos });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
