const {
  errorPayload,
  githubFetch,
  handleOptions,
  readJson,
  safeString,
  sendJson
} = require("./_shared");

const CONFIG_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const CONFIG_PATH = "configs.json";

function stripIcons(configs) {
  return configs.map(({ icon_data_url, ...rest }) => rest);
}

async function loadConfigs() {
  try {
    const data = await githubFetch(`/repos/${CONFIG_REPO}/contents/${CONFIG_PATH}`);
    let text = null;
    if (data && data.content) {
      text = Buffer.from(data.content, "base64").toString("utf8");
    } else if (data && data.download_url) {
      // File may exceed GitHub's 1MB inline limit; fetch the raw content instead
      const raw = await fetch(data.download_url);
      if (raw.ok) text = await raw.text();
    }
    if (text) {
      const parsed = JSON.parse(text);
      return {
        configs: Array.isArray(parsed.configs) ? parsed.configs : [],
        deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
        sha: data.sha
      };
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      // eslint-disable-next-line no-console
      console.error("loadConfigs failed", err && err.message);
    }
  }
  return { configs: [], deleted: [], sha: null };
}

async function saveConfigs(configs, sha, deleted = []) {
  let curSha = sha;
  if (!curSha) {
    try {
      const existing = await githubFetch(`/repos/${CONFIG_REPO}/contents/${CONFIG_PATH}`);
      curSha = existing.sha;
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
  }
  // Strip heavy icon data so configs.json stays small and readable via the API
  const clean = stripIcons(configs);
  const content = Buffer.from(JSON.stringify({ configs: clean, deleted }, null, 2)).toString("base64");
  const body = {
    message: "console: update configs",
    content,
    ...(curSha ? { sha: curSha } : {})
  };
  await githubFetch(`/repos/${CONFIG_REPO}/contents/${CONFIG_PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === "GET") {
      const { configs, deleted } = await loadConfigs();
      sendJson(req, res, 200, { ok: true, configs, deleted });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const incoming = Array.isArray(body.configs)
        ? body.configs
        : (body.config ? [body.config] : []);
      const deletedIncoming = Array.isArray(body.deleted) ? body.deleted : [];
      const { configs, sha, deleted } = await loadConfigs();
      const map = new Map(configs.map((c) => [c.id, c]));
      for (const c of incoming) {
        if (c && c.id) map.set(c.id, c);
      }
      // Honor deletions pushed from other devices
      for (const delId of deletedIncoming) map.delete(delId);
      const merged = [...map.values()];
      const newDeleted = Array.from(new Set([...deleted, ...deletedIncoming]));
      await saveConfigs(merged, sha, newDeleted);
      sendJson(req, res, 200, { ok: true, configs: merged, deleted: newDeleted });
      return;
    }

    if (req.method === "DELETE") {
      const body = await readJson(req);
      const id = safeString(body.id);
      const { configs, sha, deleted } = await loadConfigs();
      const filtered = configs.filter((c) => c.id !== id);
      const newDeleted = deleted.includes(id) ? deleted : [...deleted, id];
      await saveConfigs(filtered, sha, newDeleted);
      sendJson(req, res, 200, { ok: true, configs: filtered, deleted: newDeleted });
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
