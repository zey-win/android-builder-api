const {
  errorPayload,
  githubFetch,
  handleOptions,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

function normalizeTag(tag) {
  const raw = safeString(tag);
  if (!raw) return "";
  return raw.startsWith("v") ? raw : `v${raw}`;
}

function compareTagsAsc(left, right) {
  const parse = (value) => normalizeTag(value).replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const repository = safeString(req.query?.repository, "zey-win/ZeyWinAdsSDK-Unity");
    const minVersion = normalizeTag(req.query?.min_version, "v3.9.37");

    const response = await githubFetch(`/repos/${repository}/tags?per_page=100`);
    const tags = (Array.isArray(response) ? response : [])
      .map((entry) => normalizeTag(entry?.name))
      .filter(Boolean)
      .filter((tag) => compareTagsAsc(tag, minVersion) >= 0)
      .sort((left, right) => compareTagsAsc(right, left));

    const versions = tags.length ? tags : [minVersion];
    sendJson(req, res, 200, {
      ok: true,
      repository,
      minVersion,
      versions,
      defaultVersion: versions[0] || minVersion
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
