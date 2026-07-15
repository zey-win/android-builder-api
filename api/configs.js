const {
  errorPayload,
  handleOptions,
  readJson,
  safeString,
  sendJson
} = require("./_shared");
const db = require("./db");

const CONFIG_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === "GET") {
      const { db: data } = await db.loadDb();
      // Map games + icons into the configs format for backward compatibility
      const configs = data.games.map((g) => {
        const icon = data.icons.find((i) => i.package_name === g.package_name);
        return { ...g, icon_data_url: icon ? icon.icon_data_url : "" };
      });
      sendJson(req, res, 200, { ok: true, configs, deleted: [] });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const incoming = Array.isArray(body.configs)
        ? body.configs
        : (body.config ? [body.config] : []);
      const { db: data, sha } = await db.loadDb();

      for (const c of incoming) {
        if (c && c.id) {
          // Update or add game entry
          const idx = data.games.findIndex((g) => g.id === c.id);
          const gameEntry = { ...c, updated_at: new Date().toISOString() };
          if (idx >= 0) data.games[idx] = gameEntry;
          else data.games.push(gameEntry);

          // Also update icon if present
          if (c.icon_data_url) {
            const iconIdx = data.icons.findIndex((i) => i.package_name === c.package_name);
            const iconEntry = {
              package_name: c.package_name,
              icon_data_url: c.icon_data_url,
              updated_at: new Date().toISOString()
            };
            if (iconIdx >= 0) data.icons[iconIdx] = iconEntry;
            else data.icons.push(iconEntry);
          }
        }
      }

      await db.saveDb(data, sha);
      sendJson(req, res, 200, { ok: true, configs: data.games, deleted: data.builds || [] });
      return;
    }

    if (req.method === "DELETE") {
      const body = await readJson(req);
      const id = safeString(body.id);
      const { db: data, sha } = await db.loadDb();
      const game = data.games.find((g) => g.id === id);
      data.games = data.games.filter((g) => g.id !== id);
      if (game && game.package_name) {
        data.icons = data.icons.filter((i) => i.package_name !== game.package_name);
      }
      await db.saveDb(data, sha);
      sendJson(req, res, 200, { ok: true, configs: data.games });
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
