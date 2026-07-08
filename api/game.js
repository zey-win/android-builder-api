const {
  assertRepo,
  errorPayload,
  getAllowedRepos,
  getGithubOrg,
  githubFetch,
  handleOptions,
  requireOperator,
  safeString,
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

async function handleRepos(req, res) {
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
}

function shortVariantName(name) {
  const value = safeString(name);
  return value.split("/").filter(Boolean).pop() || value;
}

function variantKind(name) {
  if (/^app\//i.test(name)) return "app";
  if (/^release\//i.test(name)) return "release";
  if (/variant/i.test(name)) return "variant";
  return "branch";
}

async function listBranches(repo) {
  const branches = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubFetch(`/repos/${repo}/branches?per_page=100&page=${page}`);
    branches.push(...data);
    if (data.length < 100) break;
  }
  return branches;
}

async function handleBranches(req, res) {
  const repo = safeString(req.query?.game_repository || req.query?.repository);
  assertRepo(repo);

  const repoInfo = await githubFetch(`/repos/${repo}`);
  const defaultBranch = repoInfo.default_branch || "main";
  const branches = (await listBranches(repo))
    .map((branch) => ({
      name: branch.name,
      label: shortVariantName(branch.name),
      kind: variantKind(branch.name),
      protected: Boolean(branch.protected),
      sha: branch.commit?.sha || ""
    }))
    .sort((a, b) => {
      if (a.name === defaultBranch) return -1;
      if (b.name === defaultBranch) return 1;
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.label.localeCompare(b.label);
    });

  sendJson(req, res, 200, {
    ok: true,
    repository: repo,
    defaultBranch,
    branches,
    variants: branches.filter((branch) => branch.name !== defaultBranch)
  });
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const path = String(req.url || "").split("?")[0];
    if (path.endsWith("/branches")) {
      return await handleBranches(req, res);
    }
    return await handleRepos(req, res);
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
