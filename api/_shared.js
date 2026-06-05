const DEFAULT_ALLOWED_ORIGIN = "https://zey-win.github.io";
const DEFAULT_GITHUB_ORG = "zey-win";

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
  return csv(process.env.ALLOWED_GAME_REPOS, "");
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
  const expected = process.env.BUILDER_OPERATOR_KEY;
  if (!expected) {
    return;
  }

  const actual = req.headers["x-builder-key"];
  if (actual !== expected) {
    const error = new Error("Operator key is invalid.");
    error.statusCode = 401;
    throw error;
  }
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

module.exports = {
  assertRepo,
  assertSimpleRef,
  errorPayload,
  getAllowedOrigins,
  getAllowedRepos,
  getGithubOrg,
  githubFetch,
  handleOptions,
  readJson,
  requireOperator,
  safeString,
  sendJson,
  setCors
};
