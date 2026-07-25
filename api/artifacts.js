const {
  errorPayload,
  githubFetch,
  handleOptions,
  safeString,
  sendJson,
  setCors
} = require("../lib/shared");

const { kv } = require("@vercel/kv");

const CI_REPOSITORY = process.env.CI_REPOSITORY || "zey-win/ci-cd";

function parseZipLocalFileHeaders(buffer) {
  const files = [];
  let offset = 0;
  const data = Buffer.from(buffer);

  while (offset < data.length) {
    const sig = data.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compMethod = data.readUInt16LE(offset + 8);
    const compSize = data.readUInt32LE(offset + 18);
    const uncompSize = data.readUInt32LE(offset + 22);
    const nameLen = data.readUInt16LE(offset + 26);
    const extraLen = data.readUInt16LE(offset + 28);
    const name = data.toString("utf8", offset + 30, offset + 30 + nameLen);
    const dataOffset = offset + 30 + nameLen + extraLen;

    files.push({
      name,
      compMethod,
      compSize,
      uncompSize,
      dataOffset,
      data: data.slice(dataOffset, dataOffset + compSize)
    });

    offset = dataOffset + compSize;
  }

  return files;
}

async function extractFileFromZip(buffer, fileName) {
  const files = parseZipLocalFileHeaders(buffer);
  const entry = files.find(f => f.name === fileName || f.name.endsWith("/" + fileName));
  if (!entry) return null;

  if (entry.compMethod === 0) {
    return entry.data;
  }

  if (entry.compMethod === 8) {
    const zlib = require("zlib");
    return new Promise((resolve, reject) => {
      zlib.inflateRaw(entry.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    const runId = safeString(req.query?.run_id);
    const name = safeString(req.query?.name);

    if (!runId || !name) {
      sendJson(req, res, 400, { ok: false, error: "run_id and name required" });
      return;
    }

    const artifactsData = await githubFetch(
      `/repos/${CI_REPOSITORY}/actions/runs/${runId}/artifacts`
    );
    const artifacts = Array.isArray(artifactsData.artifacts)
      ? artifactsData.artifacts
      : [];
    
    // First try exact match (for IPA, Xcode project artifacts)
    let artifact = artifacts.find(a => a.name === name);
    let fileNameInZip = name;
    
    // If not found, check if it's a screenshot request and look for smoke-test-screenshots artifact
    if (!artifact && /^screen-\d+$/.test(name)) {
      artifact = artifacts.find(a => a.name === "smoke-test-screenshots");
      fileNameInZip = name + ".png";
    }

    if (!artifact) {
      sendJson(req, res, 404, { ok: false, error: "Artifact not found" });
      return;
    }

    const dlUrl = artifact.archive_download_url;
    const resp = await fetch(dlUrl, {
      headers: {
        Authorization: "Bearer " + process.env.GITHUB_TOKEN,
        "User-Agent": "zeywin-android-builder-api"
      },
      redirect: "manual"
    });

    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      const zipResp = await fetch(resp.headers.get("location"), {
        headers: {
          Authorization: "Bearer " + process.env.GITHUB_TOKEN,
          "User-Agent": "zeywin-android-builder-api"
        }
      });

      if (!zipResp.ok) {
        sendJson(req, res, 502, { ok: false, error: "Failed to download artifact zip" });
        return;
      }

      const arrayBuffer = await zipResp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileData = await extractFileFromZip(buffer, fileNameInZip);

      if (!fileData) {
        sendJson(req, res, 404, { ok: false, error: "File not found in artifact" });
        return;
      }

      setCors(req, res);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.statusCode = 200;
      res.end(fileData);
      return;
    }

    sendJson(req, res, 502, { ok: false, error: "No redirect from GitHub" });
  } catch (e) {
    sendJson(req, res, 500, { ok: false, error: e.message });
  }
};