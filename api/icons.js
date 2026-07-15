// Delegates to /api/configs (centralized DB endpoint) for icon storage.
// This file exists for backward compatibility (builder.js calls /api/icons).
const {
  errorPayload,
  handleOptions,
  readJson,
  safeString,
  sendJson
} = require("../lib/shared");
const configs = require("./configs");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const packageName = safeString(url.searchParams.get("package_name"));
      const { db } = await configs.loadDb();
      if (packageName) {
        const found = db.icons.find((i) => i.package_name === packageName) || null;
        sendJson(req, res, 200, { ok: true, icon: found });
        return;
      }
      sendJson(req, res, 200, { ok: true, icons: db.icons });
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
      const { db, sha } = await configs.loadDb();
      const idx = db.icons.findIndex((i) => i.package_name === packageName);
      const entry = { package_name: packageName, icon_data_url: iconDataUrl, updated_at: new Date().toISOString() };
      if (idx >= 0) db.icons[idx] = entry;
      else db.icons.push(entry);
      await configs.saveDb(db, sha);
      sendJson(req, res, 200, { ok: true, icon: entry });
      return;
    }

    if (req.method === "DELETE") {
      const body = await readJson(req);
      const packageName = safeString(body.package_name);
      if (!packageName) {
        sendJson(req, res, 400, { ok: false, error: "package_name is required." });
        return;
      }
      const { db, sha } = await configs.loadDb();
      db.icons = db.icons.filter((i) => i.package_name !== packageName);
      await configs.saveDb(db, sha);
      sendJson(req, res, 200, { ok: true, icons: db.icons });
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
