const {
  errorPayload,
  githubFetch,
  handleOptions,
  safeString,
  sendJson
} = require("./_shared");

// Serves a committed builder icon (builds/icons/<name>.png) from the CI repo.
// Used by the workflow runner to download the icon reliably (authenticated
// GitHub API fetch, no raw.githubusercontent.com CDN/rate-limit flakiness).
module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const rawName = safeString(req.query?.name || "");
    if (!/^[A-Za-z0-9_-]+\.png$/.test(rawName)) {
      sendJson(req, res, 400, { ok: false, error: "Invalid icon name." });
      return;
    }

    const ciRepo = process.env.CI_REPOSITORY || "zey-win/ci-cd";
    const data = await githubFetch(
      `/repos/${ciRepo}/contents/${encodeURIComponent(`builds/icons/${rawName}`)}?ref=${encodeURIComponent(process.env.CI_REF || "main")}`
    );

    if (!data || data.type !== "file" || !data.content) {
      sendJson(req, res, 404, { ok: false, error: "Icon not found." });
      return;
    }

    const buffer = Buffer.from(String(data.content).replace(/\s/g, ""), "base64");
    if (buffer.length < 8 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      sendJson(req, res, 502, { ok: false, error: "Stored icon is not a valid PNG." });
      return;
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.statusCode = 200;
    res.end(buffer);
  } catch (error) {
    if (error.statusCode === 404) {
      sendJson(req, res, 404, { ok: false, error: "Icon not found." });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("icon-file error:", error.message);
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
