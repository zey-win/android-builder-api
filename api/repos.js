const {
  errorPayload,
  getGithubOrg,
  getAllowedRepos,
  githubFetch,
  handleOptions,
  requireOperator,
  sendJson
} = require("./_shared");

async function hasUnityProject(repoFullName, defaultBranch) {
  try {
    await githubFetch(`/repos/${repoFullName}/contents/ProjectSettings/ProjectVersion.txt?ref=${encodeURIComponent(defaultBranch)}`);
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function listRepos() {
  const allowed = getAllowedRepos();
  if (allowed.length > 0) {
    const repos = [];
    for (const repo of allowed) {
      repos.push(await githubFetch(`/repos/${repo}`));
    }
    return repos;
  }

  const org = getGithubOrg();
  const repos = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubFetch(`/orgs/${org}/repos?type=all&sort=full_name&per_page=100&page=${page}`);
    repos.push(...data);
    if (data.length < 100) {
      break;
    }
  }
  return repos;
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const unityOnly = req.query?.unity_only !== "false";
    const repos = [];
    const candidates = await listRepos();
    for (const data of candidates) {
      const isUnity = await hasUnityProject(data.full_name, data.default_branch);
      if (unityOnly && !isUnity) {
        continue;
      }

      repos.push({
        fullName: data.full_name,
        name: data.name,
        owner: data.owner?.login,
        private: data.private,
        defaultBranch: data.default_branch,
        htmlUrl: data.html_url,
        unity: isUnity
      });
    }

    sendJson(req, res, 200, { ok: true, unityOnly, repos });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
