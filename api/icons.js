const {
  errorPayload,
  handleOptions,
  readJson,
  safeString,
  sendJson
} = require("./_shared");
const db = require("./db");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === "GET") {
      const packageName = safeString(req.query && req.query.package_name);
      const { db: data } = await db.loadDb();
      if (packageName) {
        const found = data.icons.find((i) => i.package_name === packageName) || null;
        sendJson(req, res, 200, { ok: true, icon: found });
        return;
      }
      sendJson(req, res, 200, { ok: true, icons: data.icons });
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
      const { db: data, sha } = await db.loadDb();
      const idx = data.icons.findIndex((i) => i.package_name === packageName);
      const entry = { package_name: packageName, icon_data_url: iconDataUrl, updated_at: new Date().toISOString() };
      if (idx >= 0) data.icons[idx] = entry;
      else data.icons.push(entry);
      await db.saveDb(data, sha);
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
      const { db: data, sha } = await db.loadDb();
      data.icons = data.icons.filter((i) => i.package_name !== packageName);
      await db.saveDb(data, sha);
      sendJson(req, res, 200, { ok: true, icons: data.icons });
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
