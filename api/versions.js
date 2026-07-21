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

    // Collect version candidates from all sources, pick the highest version_code
    var candidates = [];

    // 1. db.json entry (already best)
    if (best) {
      var vc = parseInt(best.b.version_code, 10);
      if (!isNaN(vc) && vc > 1) {
        candidates.push({ code: vc, name: safeString(best.b.version_name) });
      }
    }

    // 2. stored build inputs (aab_version_name/code always saved in SAFE_INPUT_KEYS)
    if (best && best.b.run_id) {
      try {
        var allInputs = await loadAllBuildInputs();
        var stored = allInputs[String(best.b.run_id)];
        if (stored) {
          var svc = parseInt(stored.aab_version_code || stored.version_code, 10);
          if (!isNaN(svc) && svc > 1) {
            candidates.push({ code: svc, name: safeString(stored.aab_version_name || stored.version_name) });
          }
        }
      } catch {}
    }

    // 3. ci-cd latest-build.txt
    try {
      var raw = await fetch("https://raw.githubusercontent.com/zey-win/ci-cd/main/builds/" + encodeURIComponent(packageName) + "/latest-build.txt");
      if (raw.ok) {
        var text = await raw.text();
        var mName = text.match(/^version_name=(.+)$/m);
        var mCode = text.match(/^version_code=(.+)$/m);
        if (mCode) {
          var cvc = parseInt(mCode[1], 10);
          if (!isNaN(cvc) && cvc > 1) {
            candidates.push({ code: cvc, name: mName ? mName[1] : "" });
          }
        }
      }
    } catch {}

    // Pick candidate with highest version_code
    var bestCandidate = null;
    for (var i = 0; i < candidates.length; i++) {
      if (!bestCandidate || candidates[i].code > bestCandidate.code) {
        bestCandidate = candidates[i];
      }
    }

    var versionName = bestCandidate ? bestCandidate.name : "";
    var versionCode = bestCandidate ? String(bestCandidate.code) : "";

    var fmt = safeString(best && best.b.build_format).toLowerCase();
    var aab = fmt.includes("aab") ? { versionName, versionCode } : {};
    var apk = fmt.includes("apk") ? { versionName, versionCode } : {};

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
