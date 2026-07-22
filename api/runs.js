const {
  errorPayload,
  githubFetch,
  handleOptions,
  loadHiddenBuilds,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("../lib/shared");

const fs = require("fs");
const path = require("path");

const STATS_FILE = "/tmp/visitor-stats.json";

// Releases in ci-cd are tagged `android-<runNumber>-<runAttempt>` and their
// title contains the version code (e.g. "APK com.x v12"). We use that to show
// version info on build cards for ANY historical run (no stored metadata needed).
let releasesCache = { ts: 0, map: null };
const RELEASES_TTL = 5 * 60 * 1000;

async function getReleasesVersionMap() {
  const now = Date.now();
  if (releasesCache.map && now - releasesCache.ts < RELEASES_TTL) {
    return releasesCache.map;
  }
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const map = {};
  try {
    const data = await githubFetch(`/repos/${ciRepository}/releases?per_page=100`);
    const releases = Array.isArray(data) ? data : (data && data.items) || [];
    for (const rel of releases) {
      const m = (rel.name || "").match(/v(\d+)/);
      if (m && rel.tag_name) {
        map[rel.tag_name] = { code: m[1], name: rel.name };
      }
    }
  } catch (err) {
    console.error("Failed to load releases for version map", err && err.message);
  }
  releasesCache = { ts: now, map };
  return map;
}

function versionFromRelease(run, releasesMap) {
  const tag = `android-${run.runNumber}-${run.runAttempt}`;
  const rel = releasesMap[tag];
  if (!rel) return null;
  const code = rel.code;
  return { versionName: `1.0.${code}`, versionCode: code };
}

function attachVersion(run, version) {
  if (!version) return run;
  run.versionName = version.versionName;
  run.versionCode = version.versionCode;
  return run;
}

async function findByRequestId(requestId) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  const ciWorkflow = process.env.CI_WORKFLOW || "build-apk.yml";
  const data = await githubFetch(
    `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(ciWorkflow)}/runs?event=workflow_dispatch&per_page=100`
  );

  const run = (data.workflow_runs || []).find((item) => {
    const title = `${item.display_title || ""} ${item.name || ""}`;
    return title.includes(requestId);
  });

  if (!run) {
    return null;
  }

  const mapped = {
    id: run.id,
    runNumber: run.run_number,
    runAttempt: run.run_attempt,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
    displayTitle: run.display_title || run.name
  };
  const releasesMap = await getReleasesVersionMap();
  return attachVersion(mapped, versionFromRelease(mapped, releasesMap));
}

async function listRecentRuns(workflowFileName) {
  const ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
  if (!workflowFileName) {
    return [];
  }
  const data = await githubFetch(
    `/repos/${ciRepository}/actions/workflows/${encodeURIComponent(workflowFileName)}/runs?event=workflow_dispatch&per_page=100`
  );

  const hidden = await loadHiddenBuilds();
  const releasesMap = await getReleasesVersionMap();

  const filtered = (data.workflow_runs || [])
    .filter((run) => {
      const title = `${run.display_title || ""} ${run.name || ""}`;
      const byRequest = hidden.hiddenRequestIds.some((req) => req && title.includes(req));
      const byRun = hidden.hiddenRunIds.includes(String(run.id));
      return !byRequest && !byRun;
    })
    .slice(0, 50);

  return filtered.map((run) => {
    const mapped = {
      id: run.id,
      runNumber: run.run_number,
      runAttempt: run.run_attempt,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      htmlUrl: run.html_url,
      displayTitle: run.display_title || run.name
    };
    return attachVersion(mapped, versionFromRelease(mapped, releasesMap));
  });
}

// ===== STATS (merged from stats.js) =====
function initStatsFile() {
  if (!fs.existsSync(STATS_FILE)) {
    const initialData = {
      totalVisitors: 0,
      uniqueVisitors: 0,
      pageViews: 0,
      dailyStats: {},
      recentVisits: [],
      topPages: {},
      userAgentStats: {},
      hourlyStats: []
    };
    fs.writeFileSync(STATS_FILE, JSON.stringify(initialData, null, 2));
  }
}

async function getVisitorStats() {
  initStatsFile();
  
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    return {
      totalVisitors: data.totalVisitors || 0,
      uniqueVisitors: data.uniqueVisitors || 0,
      pageViews: data.pageViews || 0,
      dailyStats: data.dailyStats || {},
      recentVisits: data.recentVisits || [],
      topPages: data.topPages || {},
      userAgentStats: data.userAgentStats || {},
      hourlyStats: data.hourlyStats || []
    };
  } catch (err) {
    console.error("Failed to load visitor stats:", err);
    return {
      totalVisitors: 0,
      uniqueVisitors: 0,
      pageViews: 0,
      dailyStats: {},
      recentVisits: [],
      topPages: {},
      userAgentStats: {},
      hourlyStats: []
    };
  }
}

function trackVisitor(req) {
  initStatsFile();
  
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const hour = now.getHours();
    const userAgent = req.headers["user-agent"] || "Unknown";
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "Unknown";
    
    data.totalVisitors = (data.totalVisitors || 0) + 1;
    data.uniqueVisitors = (data.uniqueVisitors || 0) + 1;
    data.pageViews = (data.pageViews || 0) + 1;
    
    if (!data.dailyStats) data.dailyStats = {};
    if (!data.dailyStats[today]) {
      data.dailyStats[today] = {
        visitors: 0,
        pageViews: 0,
        hourStats: Array(24).fill(0)
      };
    }
    data.dailyStats[today].visitors += 1;
    data.dailyStats[today].pageViews += 1;
    data.dailyStats[today].hourStats[hour] += 1;
    
    if (!data.hourlyStats) data.hourlyStats = [];
    const existingHourStat = data.hourlyStats.find(h => h.hour === hour && h.date === today);
    if (existingHourStat) {
      existingHourStat.views += 1;
    } else {
      data.hourlyStats.push({
        hour,
        date: today,
        views: 1
      });
    }
    
    const pathName = req.originalUrl || req.url;
    if (!data.topPages) data.topPages = {};
    if (!data.topPages[pathName]) {
      data.topPages[pathName] = {
        views: 0,
        uniqueIPs: new Set()
      };
    }
    data.topPages[pathName].views += 1;
    if (ip !== "Unknown") {
      data.topPages[pathName].uniqueIPs.add(ip);
    }
    
    if (!data.userAgentStats) data.userAgentStats = {};
    if (!data.userAgentStats[userAgent]) {
      data.userAgentStats[userAgent] = {
        views: 0,
        visitors: 0
      };
    }
    data.userAgentStats[userAgent].views += 1;
    if (ip !== "Unknown") {
      data.userAgentStats[userAgent].visitors += 1;
    }
    
    if (!data.recentVisits) data.recentVisits = [];
    const recentVisit = {
      id: `visit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: now.toISOString(),
      ip: ip,
      userAgent: userAgent,
      path: pathName,
      country: ip.includes(".") ? ip.split(".").slice(0, 2).join(".") + ".*.*" : "Unknown",
      referrer: req.headers.referer || "Direct",
      session: true,
      device: detectDevice(userAgent),
      browser: extractBrowser(userAgent)
    };
    data.recentVisits.push(recentVisit);
    
    if (data.recentVisits.length > 100) {
      data.recentVisits = data.recentVisits.slice(-100);
    }
    
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
    
    return recentVisit;
  } catch (err) {
    console.error("Error tracking visitor:", err);
    return null;
  }
}

function detectDevice(userAgent) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows Phone/.test(userAgent)) return "Windows Phone";
  if (/Macintosh/.test(userAgent)) return "Mac";
  return "Unknown";
}

function extractBrowser(userAgent) {
  if (/Chrome/.test(userAgent)) return "Chrome";
  if (/Firefox/.test(userAgent)) return "Firefox";
  if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) return "Safari";
  if (/Edge/.test(userAgent)) return "Edge";
  if (/MSIE|Trident/.test(userAgent)) return "IE";
  return "Other";
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    let pathName = "/";
    try {
      const rawUrl = (req.url || "/").toString();
      let url;
      if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        url = new URL(rawUrl);
      } else if (rawUrl.startsWith("//")) {
        url = new URL("http:" + rawUrl);
      } else {
        url = new URL(rawUrl, "http://localhost");
      }
      pathName = url.pathname;
    } catch (e) {
      const raw = (req.url || "/").toString();
      pathName = raw.split("?")[0].split("#")[0] || "/";
    }
    
    // Track all requests
    trackVisitor(req);
    
    // Handle stats endpoints
    if (pathName === "/api/stats/visitor-counts" || pathName === "/api/stats/visitor-counts/") {
      if (req.method !== "GET") {
        sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      
      const stats = await getVisitorStats();
      sendJson(req, res, 200, stats);
      return;
    }
    
    if (pathName === "/api/stats/recent-visits") {
      if (req.method !== "GET") {
        sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      
      const rawUrl = (req.url || "/").toString();
      const parsedUrl = new URL(rawUrl.startsWith("http") ? rawUrl : rawUrl, "http://localhost");
      const limit = parseInt(parsedUrl.searchParams.get("limit") || "20", 10);
      const stats = await getVisitorStats();
      const recentVisits = (stats.recentVisits || []).slice(-limit);
      sendJson(req, res, 200, recentVisits);
      return;
    }
    
    if (pathName === "/api/stats/page-stats") {
      if (req.method !== "GET") {
        sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      
      const stats = await getVisitorStats();
      sendJson(req, res, 200, {
        topPages: stats.topPages || {},
        userAgentStats: stats.userAgentStats || {},
        hourlyStats: stats.hourlyStats || []
      });
      return;
    }
    
    if (pathName === "/api/stats" || pathName === "/api/stats/") {
      if (req.method !== "GET") {
        sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      
      const stats = await getVisitorStats();
      sendJson(req, res, 200, stats);
      return;
    }
    
    // Handle runs endpoints
    requireOperator(req);

    var inputsRunId = safeString(req.query?.inputs);
    if (inputsRunId) {
      var ciRepository = process.env.CI_REPOSITORY || "zey-win/ci-cd";
      var data = await githubFetch("/repos/" + ciRepository + "/actions/runs/" + inputsRunId);
      var inputs = data.event && data.event.inputs ? data.event.inputs : {};
      sendJson(req, res, 200, { ok: true, inputs: inputs });
      return;
    }

    let requestId = safeString(req.query?.request_id);
    if (req.method === "POST") {
      const body = await readJson(req, 100_000);
      requestId = safeString(body.request_id || requestId);
    }

    if (!requestId) {
      var workflowParam = safeString(req.query?.workflow);
      var workflowFile = "";
      if (workflowParam === "2") {
        workflowFile = process.env.CI_WORKFLOW_2 || "";
      } else {
        workflowFile = process.env.CI_WORKFLOW || "build-apk.yml";
      }
      const runs = await listRecentRuns(workflowFile);
      sendJson(req, res, 200, { ok: true, runs });
      return;
    }

    const run = await findByRequestId(requestId);
    sendJson(req, res, 200, { ok: true, requestId, run });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
