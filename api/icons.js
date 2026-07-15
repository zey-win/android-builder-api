const {
  errorPayload,
  githubFetch,
  handleOptions,
  readJson,
  safeString,
  sendJson
} = require("./_shared");

const ICON_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const ICON_PATH = "icons.json";

async function loadIcons() {
  try {
    const data = await githubFetch(`/repos/${ICON_REPO}/contents/${ICON_PATH}`);
    let text = null;
    if (data && data.content) {
      text = Buffer.from(data.content, "base64").toString("utf8");
    } else if (data && data.download_url) {
      // File may exceed GitHub's 1MB inline limit; fetch the raw content instead
      const raw = await fetch(data.download_url);
      if (raw.ok) text = await raw.text();
    }
    if (text) {
      const parsed = JSON.parse(text);
      return {
        icons: Array.isArray(parsed.icons) ? parsed.icons : [],
        sha: data.sha
      };
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      // eslint-disable-next-line no-console
      console.error("loadIcons failed", err && err.message);
    }
  }
  return { icons: [], sha: null };
}

async function saveIcons(icons, sha) {
  let curSha = sha;
  if (!curSha) {
    try {
      const existing = await githubFetch(`/repos/${ICON_REPO}/contents/${ICON_PATH}`);
      curSha = existing.sha;
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
  }
  const content = Buffer.from(JSON.stringify({ icons }, null, 2)).toString("base64");
  const body = {
    message: "console: update icons",
    content,
    ...(curSha ? { sha: curSha } : {})
  };
  await githubFetch(`/repos/${ICON_REPO}/contents/${ICON_PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === "GET") {
      const packageName = safeString(req.query && req.query.package_name);
      const { icons } = await loadIcons();
      if (packageName) {
        const found = icons.find((i) => i.package_name === packageName) || null;
        sendJson(req, res, 200, { ok: true, icon: found });
        return;
      }
      sendJson(req, res, 200, { ok: true, icons });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const packageName = safeString(body.package_name);
      const iconDataUrl = safeString(body.icon_data_url);
      if (!packageName) {
        sendJson(req, res, 400, { ok: false, error: "package_name is required." });
        return;
      }
      if (!/^data:image\//.test(iconDataUrl)) {
        sendJson(req, res, 400, { ok: false, error: "icon_data_url must be an image data URI." });
        return;
      }
      const { icons, sha } = await loadIcons();
      const map = new Map(icons.map((i) => [i.package_name, i]));
      map.set(packageName, {
        package_name: packageName,
        icon_data_url: iconDataUrl,
        updated_at: new Date().toISOString()
      });
      const merged = [...map.values()];
      await saveIcons(merged, sha);
      const saved = merged.find((i) => i.package_name === packageName);
      sendJson(req, res, 200, { ok: true, icon: saved });
      return;
    }

    if (req.method === "DELETE") {
      const body = await readJson(req);
      const packageName = safeString(body.package_name);
      if (!packageName) {
        sendJson(req, res, 400, { ok: false, error: "package_name is required." });
        return;
      }
      const { icons, sha } = await loadIcons();
      const filtered = icons.filter((i) => i.package_name !== packageName);
      await saveIcons(filtered, sha);
      sendJson(req, res, 200, { ok: true, icons: filtered });
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
