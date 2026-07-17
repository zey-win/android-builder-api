const { errorPayload, handleOptions, safeString, sendJson } = require("../lib/shared");
const { buildGames } = require("./db");

// The icon has a SINGLE source of truth: the config's `icon_url` (or
// `icon_base64`) in configs.json. The same value is sent to the CI build, so
// the build card and the generated APK always show the identical image.
// No repository scanning, no static maps, no guessing.
module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const repo = safeString(req.query?.game_repository || req.query?.repository);
    const packageName = safeString(req.query?.package_name);

    const games = await buildGames();
    const game = games.find(
      (g) =>
        (packageName && g.package_name === packageName) ||
        (repo && g.repo === repo)
    );

    let icon = null;
    if (game) {
      if (game.icon_base64) {
        icon = { dataUrl: `data:image/png;base64,${game.icon_base64}`, source: "config-base64" };
      } else if (game.icon_url) {
        icon = { dataUrl: game.icon_url, source: "config-url" };
      }
    }

    sendJson(req, res, 200, {
      ok: true,
      repository: repo,
      package_name: packageName,
      found: Boolean(icon),
      icon
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
