const DEFAULT_ALLOWED_ORIGIN = "https://zey-win.github.io,https://zey-wingithubio.vercel.app";
const DEFAULT_GITHUB_ORG = "zey-win";
const DEFAULT_GAME_REPOS = [
  "zey-win/plinko",
  "zey-win/SlotSpot",
  "zey-win/Unstopable",
  "zey-win/wheel-of-fortune",
  "zey-win/blackjack",
  "zey-win/baccarat-tiger",
  "zey-win/roulette",
  "zey-win/dragon-tiger"
];

function csv(value, fallback) {
  return String(value || fallback || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedOrigins() {
  return csv(process.env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGIN);
}

function getAllowedRepos() {
  const configured = csv(process.env.ALLOWED_GAME_REPOS, "");
  return configured.length ? [...new Set([...DEFAULT_GAME_REPOS, ...configured])] : DEFAULT_GAME_REPOS;
}

function getGithubOrg() {
  return String(process.env.GITHUB_ORG || DEFAULT_GITHUB_ORG).trim();
}

function setCors(req, res) {
  const allowed = getAllowedOrigins();
  const origin = req.headers.origin;
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] || DEFAULT_ALLOWED_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-builder-key");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

function handleOptions(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function sendJson(req, res, status, payload) {
  setCors(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function requireOperator(req) {
  return;
}

function requireToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    const error = new Error("Server is missing GITHUB_TOKEN.");
    error.statusCode = 500;
    throw error;
  }
  return token;
}

function isAllowedRepo(repo) {
  const allowed = getAllowedRepos();
  if (allowed.length > 0) {
    return allowed.includes(repo);
  }

  const org = getGithubOrg();
  return repo.startsWith(`${org}/`);
}

function assertRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "")) {
    const error = new Error("Invalid repository name.");
    error.statusCode = 400;
    throw error;
  }

  if (!isAllowedRepo(repo)) {
    const error = new Error(`Repository is not allowed: ${repo}`);
    error.statusCode = 403;
    throw error;
  }
}

function assertSimpleRef(ref) {
  if (!/^[A-Za-z0-9_./-]+$/.test(ref || "")) {
    const error = new Error("Invalid git ref.");
    error.statusCode = 400;
    throw error;
  }
}

async function readJson(req, limitBytes = 7_000_000) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

function safeString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function parseKeyValueText(text) {
  return Object.fromEntries(
    String(text || "")
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function releaseDownloadUrl(releaseUrl, assetName) {
  const name = safeString(assetName);
  const url = safeString(releaseUrl);
  if (!name || !url) return "";

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const releaseIndex = parts.findIndex((part, index) => part === "releases" && parts[index + 1] === "tag");
    const tag = releaseIndex >= 0 ? parts[releaseIndex + 2] : "";
    const owner = parts[0] || "";
    const repo = parts[1] || "";
    if (!owner || !repo || !tag) return "";

    return `${parsed.origin}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/download/${encodeURIComponent(tag)}/${name
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  } catch {
    return "";
  }
}

function buildReleaseAssetLinks(meta) {
  const releaseUrl = meta.github_release || meta.apk_release || "";
  const candidates = [
    ...splitCsv(meta.package_assets).map((name) => ({ name })),
    { name: meta.apk_asset, type: "APK" },
    { name: meta.aab_asset, type: "AAB" }
  ];
  const seen = new Set();

  return candidates
    .map((candidate) => {
      const name = safeString(candidate.name);
      if (!name || seen.has(name)) return null;
      seen.add(name);

      const lower = name.toLowerCase();
      const type = candidate.type || (lower.endsWith(".aab") ? "AAB" : lower.endsWith(".apk") ? "APK" : "Android");
      return {
        type,
        name,
        downloadUrl: releaseDownloadUrl(releaseUrl, name)
      };
    })
    .filter((asset) => asset && asset.downloadUrl);
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "User-Agent": "zeywin-android-builder-api",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubFetch(path, options = {}) {
  const token = requireToken();
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(data?.message || `GitHub request failed: ${response.status}`);
    error.statusCode = response.status;
    error.github = data;
    throw error;
  }

  return data;
}

function errorPayload(error) {
  return {
    ok: false,
    error: error.message || "Unknown error",
    details: error.github || undefined
  };
}

const HIDDEN_FILE_REPO = "zey-win/android-builder-api";
const HIDDEN_FILE_PATH = "data/hidden-builds.json";

const BUILD_INPUTS_REPO = "zey-win/android-builder-api";
const BUILD_INPUTS_PATH = "data/build-inputs.json";

// Only non-secret, non-binary fields are persisted publicly (the repo is public).
const SAFE_INPUT_KEYS = [
  "builder_request_id",
  "game_repository",
  "game_ref",
  "package_name",
  "app_name",
  "icon_png_path",
  "zeywin_sdk_version",
  "version_mode",
  "version_name",
  "version_code",
  "aab_version_name",
  "aab_version_code",
  "build_format",
  "fast_build",
  "signing_profile"
];

function sanitizeInputs(inputs) {
  const out = {};
  if (!inputs || typeof inputs !== "object") return out;
  for (const key of SAFE_INPUT_KEYS) {
    if (inputs[key] != null) out[key] = inputs[key];
  }
  return out;
}

async function loadAllBuildInputs() {
  try {
    const data = await githubFetch(`/repos/${BUILD_INPUTS_REPO}/contents/${BUILD_INPUTS_PATH}`);
    if (data && data.content) {
      const parsed = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      return parsed.inputs && typeof parsed.inputs === "object" ? parsed.inputs : {};
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      // eslint-disable-next-line no-console
      console.error("Failed to load build inputs", err.message);
    }
  }
  return {};
}

const RUN_META_REPO = process.env.CI_REPOSITORY || "zey-win/ci-cd";
const RUN_META_PATH = "builds/run-meta.json";

async function loadRunMeta() {
  try {
    const data = await githubFetch(`/repos/${RUN_META_REPO}/contents/${RUN_META_PATH}`);
    if (data && data.content) {
      const parsed = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      return parsed.runs && typeof parsed.runs === "object" ? parsed.runs : {};
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      // eslint-disable-next-line no-console
      console.error("Failed to load run meta", err.message);
    }
  }
  return {};
}

async function saveBuildInputs(runId, inputs) {
  const rid = String(runId || "");
  if (!rid) return;
  const all = await loadAllBuildInputs();
  all[rid] = sanitizeInputs(inputs);

  const repo = BUILD_INPUTS_REPO;
  const path = BUILD_INPUTS_PATH;
  let sha;
  try {
    const existing = await githubFetch(`/repos/${repo}/contents/${path}`);
    sha = existing.sha;
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }

  const contentObj = {
    updatedAt: new Date().toISOString(),
    inputs: all
  };
  const content = Buffer.from(JSON.stringify(contentObj, null, 2)).toString("base64");
  const body = {
    message: `console: store build inputs for run ${rid}`,
    content,
    ...(sha ? { sha } : {})
  };

  await githubFetch(`/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function loadHiddenBuilds() {
  try {
    const data = await githubFetch(`/repos/${HIDDEN_FILE_REPO}/contents/${HIDDEN_FILE_PATH}`);
    if (data && data.content) {
      const text = Buffer.from(data.content, "base64").toString("utf8");
      const parsed = JSON.parse(text);
      return {
        hiddenRequestIds: Array.isArray(parsed.hiddenRequestIds) ? parsed.hiddenRequestIds : [],
        hiddenRunIds: Array.isArray(parsed.hiddenRunIds) ? parsed.hiddenRunIds.map(String) : []
      };
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      // eslint-disable-next-line no-console
      console.error("Failed to load hidden builds", err.message);
    }
  }
  return { hiddenRequestIds: [], hiddenRunIds: [] };
}

async function addHiddenBuild({ requestId, runId } = {}) {
  const hidden = await loadHiddenBuilds();
  let changed = false;

  const req = safeString(requestId);
  if (req && !hidden.hiddenRequestIds.includes(req)) {
    hidden.hiddenRequestIds.push(req);
    changed = true;
  }

  const rid = runId ? String(runId) : "";
  if (rid && !hidden.hiddenRunIds.includes(rid)) {
    hidden.hiddenRunIds.push(rid);
    changed = true;
  }

  if (!changed) {
    return hidden;
  }

  const repo = HIDDEN_FILE_REPO;
  const path = HIDDEN_FILE_PATH;

  let sha;
  try {
    const existing = await githubFetch(`/repos/${repo}/contents/${path}`);
    sha = existing.sha;
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }

  const contentObj = {
    hiddenRequestIds: hidden.hiddenRequestIds,
    hiddenRunIds: hidden.hiddenRunIds,
    updatedAt: new Date().toISOString()
  };
  const content = Buffer.from(JSON.stringify(contentObj, null, 2)).toString("base64");

  const body = {
    message: `console: hide build ${req || rid}`,
    content,
    ...(sha ? { sha } : {})
  };

  await githubFetch(`/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return hidden;
}

module.exports = {
  assertRepo,
  assertSimpleRef,
  buildReleaseAssetLinks,
  errorPayload,
  getAllowedOrigins,
  getAllowedRepos,
  getGithubOrg,
  githubFetch,
  handleOptions,
  parseKeyValueText,
  readJson,
  requireOperator,
  safeString,
  sendJson,
  setCors,
  loadHiddenBuilds,
  addHiddenBuild,
  loadAllBuildInputs,
  loadRunMeta,
  saveBuildInputs,
  sanitizeInputs
};
