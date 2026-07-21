const {
  errorPayload,
  githubFetch,
  handleOptions,
  loadAllBuildInputs,
  safeString,
  sendJson
} = require("./_shared");

const DB_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const DB_PATH = "db.json";

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
      return JSON.parse(text);
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      console.error("loadDb failed", err && err.message);
    }
  }
  return { games: [], icons: [], builds: [], updated_at: null };
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    const url = new URL(req.url, "http://localhost");
    const packageName = safeString(url.searchParams.get("package_name"));
    if (!packageName) {
      sendJson(req, res, 400, { ok: false, error: "package_name is required" });
      return;
    }

    const db = await loadDb();
    const builds = Array.isArray(db.builds) ? db.builds : [];
    const matches = builds.filter((b) => safeString(b.package_name) === packageName);

    let best = null;
    for (const b of matches) {
      const code = parseInt(b.version_code, 10);
      if (isNaN(code)) continue;
      if (!best || code > best.code) best = { code, b };
    }

    // If best match has version_code "1" (the old hardcoded value),
    // try to get real version from stored build inputs
    let versionName = best ? safeString(best.b.version_name) : "";
    let versionCode = best ? safeString(best.b.version_code) : "";
    if (best && (!versionCode || versionCode === "1") && best.b.run_id) {
      try {
        const allInputs = await loadAllBuildInputs();
        const stored = allInputs[String(best.b.run_id)];
        if (stored) {
          versionName = safeString(stored.aab_version_name || stored.version_name || versionName);
          versionCode = safeString(stored.aab_version_code || stored.version_code || versionCode);
        }
      } catch {}
    }

    // Final fallback: read version from CI-CD latest-build.txt
    if (!versionCode || versionCode === "1") {
      try {
        const raw = await fetch("https://raw.githubusercontent.com/zey-win/ci-cd/main/builds/" + encodeURIComponent(packageName) + "/latest-build.txt");
        if (raw.ok) {
          const text = await raw.text();
          const mName = text.match(/^version_name=(.+)$/m);
          const mCode = text.match(/^version_code=(.+)$/m);
          if (mCode && mCode[1] && mCode[1] !== "1") {
            versionName = mName ? mName[1] : versionName;
            versionCode = mCode[1];
          }
        }
      } catch {}
    }

    const fmt = safeString(best && best.b.build_format).toLowerCase();
    const aab = fmt.includes("aab") ? { versionName, versionCode } : {};
    const apk = fmt.includes("apk") ? { versionName, versionCode } : {};

    sendJson(req, res, 200, {
      ok: true,
      package_name: packageName,
      aab,
      apk,
      versionName,
      versionCode
    });
  } catch (err) {
    sendJson(req, res, 500, errorPayload(err));
  }
};
