const {
  assertRepo,
  errorPayload,
  githubFetch,
  handleOptions,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

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

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

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
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
