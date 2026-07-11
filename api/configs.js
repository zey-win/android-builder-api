const {
  errorPayload,
  githubFetch,
  handleOptions,
  parseKeyValueText,
  readJson,
  safeString,
  sendJson
} = require("./_shared");

const CONFIG_REPO = process.env.CONFIG_REPO || "zey-win/zey-win.github.io";
const CONFIG_PATH = "configs.json";

async function loadConfigs() {
  try {
    const data = await githubFetch(`/repos/${CONFIG_REPO}/contents/${CONFIG_PATH}`);
    if (data && data.content) {
      const text = Buffer.from(data.content, "base64").toString("utf8");
      const parsed = JSON.parse(text);
      return { configs: Array.isArray(parsed.configs) ? parsed.configs : [], sha: data.sha };
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      // eslint-disable-next-line no-console
      console.error("loadConfigs failed", err.message);
    }
  }
  return { configs: [], sha: null };
}

async function saveConfigs(configs, sha) {
  let curSha = sha;
  if (!curSha) {
    try {
      const existing = await githubFetch(`/repos/${CONFIG_REPO}/contents/${CONFIG_PATH}`);
      curSha = existing.sha;
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
  }
  const content = Buffer.from(JSON.stringify({ configs }, null, 2)).toString("base64");
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
      const { configs } = await loadConfigs();
      sendJson(req, res, 200, { ok: true, configs });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const incoming = Array.isArray(body.configs)
        ? body.configs
        : (body.config ? [body.config] : []);
      const { configs, sha } = await loadConfigs();
      const map = new Map(configs.map((c) => [c.id, c]));
      for (const c of incoming) {
        if (c && c.id) map.set(c.id, c);
      }
      const merged = [...map.values()];
      await saveConfigs(merged, sha);
      sendJson(req, res, 200, { ok: true, configs: merged });
      return;
    }

    if (req.method === "DELETE") {
      const body = await readJson(req);
      const id = safeString(body.id);
      const { configs, sha } = await loadConfigs();
      const filtered = configs.filter((c) => c.id !== id);
      if (filtered.length !== configs.length) {
        await saveConfigs(filtered, sha);
      }
      sendJson(req, res, 200, { ok: true, configs: filtered });
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};
