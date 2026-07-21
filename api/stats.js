const {
  errorPayload,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '../zey-win.github.io/visitor-stats.json');

// Initialize stats file if not exists
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

// Get visitor statistics
async function getVisitorStats() {
  initStatsFile();
  
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
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

// Track visitor activity
function trackVisitor(req) {
  initStatsFile();
  
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const hour = now.getHours();
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Unknown';
    
    // Update visitor counts
    data.totalVisitors = (data.totalVisitors || 0) + 1;
    data.uniqueVisitors = (data.uniqueVisitors || 0) + 1;
    data.pageViews = (data.pageViews || 0) + 1;
    
    // Update daily stats
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
    
    // Update hourly stats
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
    
    // Update top pages
    const pathName = req.originalUrl || req.url;
    if (!data.topPages) data.topPages = {};
    if (!data.topPages[pathName]) {
      data.topPages[pathName] = {
        views: 0,
        uniqueIPs: new Set()
      };
    }
    data.topPages[pathName].views += 1;
    if (ip !== 'Unknown') {
      data.topPages[pathName].uniqueIPs.add(ip);
    }
    
    // Update user agent stats
    if (!data.userAgentStats) data.userAgentStats = {};
    if (!data.userAgentStats[userAgent]) {
      data.userAgentStats[userAgent] = {
        views: 0,
        visitors: 0
      };
    }
    data.userAgentStats[userAgent].views += 1;
    if (ip !== 'Unknown') {
      data.userAgentStats[userAgent].visitors += 1;
    }
    
    // Track recent visits
    if (!data.recentVisits) data.recentVisits = [];
    const recentVisit = {
      id: `visit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: now.toISOString(),
      ip: ip,
      userAgent: userAgent,
      path: pathName,
      country: ip.includes('.') ? ip.split('.').slice(0, 2).join('.') + '.*.*' : 'Unknown',
      referrer: req.headers.referer || 'Direct',
      session: true,
      device: detectDevice(userAgent),
      browser: extractBrowser(userAgent)
    };
    data.recentVisits.push(recentVisit);
    
    // Keep only last 100 visits
    if (data.recentVisits.length > 100) {
      data.recentVisits = data.recentVisits.slice(-100);
    }
    
    // Save updated data
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
    
    return recentVisit;
  } catch (err) {
    console.error("Error tracking visitor:", err);
    return null;
  }
}

// Helper functions
function detectDevice(userAgent) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows Phone/.test(userAgent)) return 'Windows Phone';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  return 'Unknown';
}

function extractBrowser(userAgent) {
  if (/Chrome/.test(userAgent)) return 'Chrome';
  if (/Firefox/.test(userAgent)) return 'Firefox';
  if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) return 'Safari';
  if (/Edge/.test(userAgent)) return 'Edge';
  if (/MSIE|Trident/.test(userAgent)) return 'IE';
  return 'Other';
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  
  try {
    const pathName = new URL(req.url).pathname;
    
    // Track all requests
    trackVisitor(req);
    
    if (pathName === '/api/stats/visitor-counts' || pathName === '/api/stats/visitor-counts/') {
      if (req.method !== 'GET') {
        sendJson(req, res, 405, { ok: false, error: 'Method not allowed' });
        return;
      }
      
      const stats = await getVisitorStats();
      sendJson(req, res, 200, stats);
      return;
    }
    
    if (pathName === '/api/stats/recent-visits') {
      if (req.method !== 'GET') {
        sendJson(req, res, 405, { ok: false, error: 'Method not allowed' });
        return;
      }
      
      const limit = parseInt(new URL(req.url).searchParams.get('limit') || '20', 10);
      const stats = await getVisitorStats();
      const recentVisits = (stats.recentVisits || []).slice(-limit);
      sendJson(req, res, 200, recentVisits);
      return;
    }
    
    if (pathName === '/api/stats/page-stats') {
      if (req.method !== 'GET') {
        sendJson(req, res, 405, { ok: false, error: 'Method not allowed' });
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
    
    if (pathName === '/api/stats' || pathName === '/api/stats/') {
      if (req.method !== 'GET') {
        sendJson(req, res, 405, { ok: false, error: 'Method not allowed' });
        return;
      }
      
      const stats = await getVisitorStats();
      sendJson(req, res, 200, stats);
      return;
    }
    
    sendJson(req, res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    sendJson(req, res, 500, errorPayload(err));
  }
};
