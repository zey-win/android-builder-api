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

let versionCountCache = new Map();

async function loadVersionCountCache() {
  if (versionCountCache.size > 0) return versionCountCache;
  
  const db = await loadDb();
  const builds = Array.isArray(db.builds) ? db.builds : [];
  
  const versionMap = new Map();
  for (const build of builds) {
    const pkg = safeString(build.package_name);
    if (!pkg) continue;
    
    const runs = await loadAllRunsForPackage(pkg);
    if (runs.length > 0) {
      versionMap.set(pkg, runs.length);
    }
  }
  
  versionCountCache = versionMap;
  return versionCountCache;
}

async function loadAllRunsForPackage(packageName) {
  const runs = [];
  const ciRepo = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  
  try {
    const data = await githubFetch(
      `/repos/${ciRepo}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=50`
    );
    
    const workflowRuns = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    const matchingRuns = workflowRuns.filter(run => {
      const displayTitle = `${run.display_title || ''} ${run.name || ''}`;
      return displayTitle.includes(packageName);
    });
    
    runs.push(...matchingRuns);
  } catch (err) {
    console.error("Failed to load runs for version count", err && err.message);
  }
  
  return runs;
}

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

    const versionCount = await loadVersionCountCache();
    const count = versionCount.get(packageName) || matches.length;
    const baseVersion = Math.max(1, count);
    
    let best = null;
    const candidates = [];
    
    for (const b of matches) {
      const code = parseInt(b.version_code, 10);
      if (isNaN(code)) continue;
      candidates.push({ code, name: safeString(b.version_name), build: b });
      if (!best || code > best.code) {
        best = { code, name: safeString(b.version_name), build: b };
      }
    }

    if (best && best.build && best.build.run_id) {
      try {
        const allInputs = await loadAllBuildInputs();
        const stored = allInputs[String(best.build.run_id)];
        if (stored) {
          const svc = parseInt(stored.aab_version_code || stored.version_code, 10);
          if (!isNaN(svc) && svc > 1) {
            candidates.push({ code: svc, name: safeString(stored.aab_version_name || stored.version_name), build: stored });
            if (!best || svc > best.code) {
              best = { code: svc, name: safeString(stored.aab_version_name || stored.version_name), build: stored };
            }
          }
        }
      } catch {}
    }

    try {
      const raw = await fetch("https://raw.githubusercontent.com/zey-win/ci-cd/main/builds/" + encodeURIComponent(packageName) + "/latest-build.txt");
      if (raw.ok) {
        const text = await raw.text();
        const mName = text.match(/^version_name=(.+)$/m);
        const mCode = text.match(/^version_code=(.+)$/m);
        if (mCode) {
          const cvc = parseInt(mCode[1], 10);
          if (!isNaN(cvc) && cvc > 1) {
            candidates.push({ code: cvc, name: mName ? mName[1] : "", source: "ci-cd" });
            if (!best || cvc > best.code) {
              best = { code: cvc, name: mName ? mName[1] : "", source: "ci-cd" };
            }
          }
        }
      }
    } catch {}

    var versionName = best ? (best.name || baseVersion + ".0") : baseVersion + ".0";
    var versionCode = best ? String(best.code) : String(baseVersion);

    var fmt = "apk_aab";
    var aab = fmt.includes("aab") ? { versionName, versionCode } : {};
    var apk = fmt.includes("apk") ? { versionName, versionCode } : {};

    sendJson(req, res, 200, {
      ok: true,
      package_name: packageName,
      aab,
      apk,
      versionName,
      versionCode,
      candidates: candidates.map(c => ({
        versionName: c.name,
        versionCode: c.build ? String(c.build.version_name || c.build.aab_version_name || c.code) : String(c.code),
        build: c.build
      }))
    });
  } catch (err) {
    sendJson(req, res, 500, errorPayload(err));
  }
};
