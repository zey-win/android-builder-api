const {
  errorPayload,
  githubFetch,
  handleOptions,
  readJson,
  safeString,
  sendJson
} = require("../lib/shared");

const DB_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const DB_PATH = "db.json";

const DEFAULT_DB = { games: [], icons: [], builds: [], updated_at: null };

async function loadDb() {
  try {
    const data = await githubFetch(`/repos/${DB_REPO}/contents/${DB_PATH}`);
    let text = null;
    if (data && data.content) {
      text = Buffer.from(data.content, "base64").toString("utf8");
    } else if (data && data.download_url) {
      const raw = await fetch(data.download_url);
      if (raw.ok) text = await raw.text();
    }
    if (text) {
      const parsed = JSON.parse(text);
      return {
        db: {
          games: Array.isArray(parsed.games) ? parsed.games : [],
          icons: Array.isArray(parsed.icons) ? parsed.icons : [],
          builds: Array.isArray(parsed.builds) ? parsed.builds : [],
          updated_at: parsed.updated_at || null,
          ...parsed
        },
        sha: data.sha
      };
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      console.error("loadDb failed", err && err.message);
    }
  }
  return { db: { ...DEFAULT_DB }, sha: null };
}

async function saveDb(db, sha, attempt = 0) {
  let curSha = sha;
  if (!curSha) {
    try {
      const existing = await githubFetch(`/repos/${DB_REPO}/contents/${DB_PATH}`);
      curSha = existing.sha;
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
  }
  db.updated_at = new Date().toISOString();
  const content = Buffer.from(JSON.stringify(db, null, 2)).toString("base64");
  const body = {
    message: "console: update db",
    content,
    ...(curSha ? { sha: curSha } : {})
  };
  try {
    await githubFetch(`/repos/${DB_REPO}/contents/${DB_PATH}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    // Another writer (e.g. a concurrent build) changed db.json; reload sha and retry.
    if ((err.statusCode === 409 || err.statusCode === 422) && attempt < 5) {
      return saveDb(db, null, attempt + 1);
    }
    throw err;
  }
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === "GET") {
      const { db } = await loadDb();
      const url = new URL(req.url, "http://localhost");
      const section = safeString(url.searchParams.get("section"));
      const packageName = safeString(url.searchParams.get("package_name"));
      if (section === "games") {
        sendJson(req, res, 200, { ok: true, games: db.games });
        return;
      }
      if (section === "icons") {
        sendJson(req, res, 200, { ok: true, icons: db.icons });
        return;
      }
      if (section === "builds") {
        sendJson(req, res, 200, { ok: true, builds: db.builds });
        return;
      }
      if (packageName) {
        const icon = db.icons.find((i) => i.package_name === packageName) || null;
        const game = db.games.find((g) => g.package_name === packageName) || null;
        sendJson(req, res, 200, { ok: true, icon, game });
        return;
      }
      // Legacy configs format: merge games+icons
      const configs = db.games.map((g) => {
        const icon = db.icons.find((i) => i.package_name === g.package_name);
        return { ...g, icon_data_url: icon ? icon.icon_data_url : "" };
      });
      sendJson(req, res, 200, { ok: true, configs, deleted: db.builds || [], games: db.games, icons: db.icons, builds: db.builds });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const { db, sha } = await loadDb();

      // Update icons (POST /api/icons compatibility)
      if (body.icon && body.icon.package_name) {
        const idx = db.icons.findIndex((i) => i.package_name === body.icon.package_name);
        const entry = {
          package_name: body.icon.package_name,
          icon_data_url: body.icon.icon_data_url || "",
          icon_base64: body.icon.icon_base64 || "",
          updated_at: new Date().toISOString()
        };
        if (idx >= 0) db.icons[idx] = entry;
        else db.icons.push(entry);
      } else if (body.package_name && body.icon_data_url) {
        // Legacy icons.js POST format
        const idx = db.icons.findIndex((i) => i.package_name === body.package_name);
        const entry = { package_name: body.package_name, icon_data_url: body.icon_data_url, updated_at: new Date().toISOString() };
        if (idx >= 0) db.icons[idx] = entry;
        else db.icons.push(entry);
      }

      // Update games (legacy configs.js POST format)
      if (body.configs && Array.isArray(body.configs)) {
        for (const c of body.configs) {
          if (c && c.id) {
            const idx = db.games.findIndex((g) => g.id === c.id);
            const gameEntry = { ...c, updated_at: new Date().toISOString() };
            if (idx >= 0) db.games[idx] = gameEntry;
            else db.games.push(gameEntry);
            if (c.icon_data_url) {
              const iconIdx = db.icons.findIndex((i) => i.package_name === c.package_name);
              const iconEntry = { package_name: c.package_name, icon_data_url: c.icon_data_url, updated_at: new Date().toISOString() };
              if (iconIdx >= 0) db.icons[iconIdx] = iconEntry;
              else db.icons.push(iconEntry);
            }
          }
        }
      }

      // Update game (single game entry)
      if (body.game && body.game.package_name) {
        const idx = db.games.findIndex((g) => g.package_name === body.game.package_name);
        if (idx >= 0) db.games[idx] = { ...db.games[idx], ...body.game, updated_at: new Date().toISOString() };
        else db.games.push({ ...body.game, updated_at: new Date().toISOString() });
      }

      // Update single config (frontend sends { config: cfg })
      if (body.config && typeof body.config === "object") {
        const c = body.config;
        const cfgId = c.id || c.package_name;
        if (cfgId) {
          const idx = db.games.findIndex((g) => (c.id && g.id === c.id) || (c.package_name && g.package_name === c.package_name));
          const gameEntry = { ...(idx >= 0 ? db.games[idx] : {}), ...c, updated_at: new Date().toISOString() };
          if (idx >= 0) db.games[idx] = gameEntry;
          else db.games.push(gameEntry);
        }
        const iconData = c.icon_data_url || c.icon_url || "";
        if (c.package_name && iconData) {
          const iconIdx = db.icons.findIndex((i) => i.package_name === c.package_name);
          const iconEntry = { package_name: c.package_name, icon_data_url: iconData, updated_at: new Date().toISOString() };
          if (iconIdx >= 0) db.icons[iconIdx] = iconEntry;
          else db.icons.push(iconEntry);
        }
      }

      // Update build (single build record)
      if (body.build && body.build.run_id) {
        const idx = db.builds.findIndex((b) => b.run_id === body.build.run_id);
        if (idx >= 0) db.builds[idx] = { ...db.builds[idx], ...body.build, updated_at: new Date().toISOString() };
        else db.builds.push({ ...body.build, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }

      // Full replace of sections
      if (body.icons && Array.isArray(body.icons)) db.icons = body.icons;
      if (body.games && Array.isArray(body.games)) db.games = body.games;
      if (body.builds && Array.isArray(body.builds)) db.builds = body.builds;

      await saveDb(db, sha);
      sendJson(req, res, 200, { ok: true, ...db });
      return;
    }

    if (req.method === "DELETE") {
      const body = await readJson(req);
      const { db, sha } = await loadDb();
      const id = safeString(body.id);
      const packageName = safeString(body.package_name);
      const runId = safeString(body.run_id);

      if (id) {
        const game = db.games.find((g) => g.id === id);
        db.games = db.games.filter((g) => g.id !== id);
        if (game && game.package_name) {
          db.icons = db.icons.filter((i) => i.package_name !== game.package_name);
        }
      }
      if (packageName) {
        db.icons = db.icons.filter((i) => i.package_name !== packageName);
      }
      if (runId) {
        db.builds = db.builds.filter((b) => String(b.run_id) !== runId);
      }
      await saveDb(db, sha);
      sendJson(req, res, 200, { ok: true, ...db });
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};

module.exports.loadDb = loadDb;
module.exports.saveDb = saveDb;
