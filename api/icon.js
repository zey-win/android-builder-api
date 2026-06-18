const {
  assertRepo,
  assertSimpleRef,
  errorPayload,
  githubFetch,
  handleOptions,
  requireOperator,
  safeString,
  sendJson
} = require("./_shared");

const PNG_MAGIC = "89504e470d0a1a0a";
const MAX_PREVIEW_BYTES = 2_500_000;
const STATIC_ICON_CANDIDATES = [
  "Assets/ZeyWin/IconOverride/android-icon.png",
  "Assets/Sprites/Icon.png",
  "Assets/Sprites/icon.png",
  "Assets/AppIcon.png",
  "Assets/app-icon.png",
  "Assets/app_icon.png",
  "Assets/LauncherIcon.png",
  "Assets/launcher-icon.png",
  "Assets/launcher_icon.png",
  "Assets/Icons/AppIcon.png",
  "Assets/Icons/icon.png",
  "Assets/Resources/AppIcon.png",
  "Assets/Resources/Icon.png",
  "Assets/Plugins/Android/res/drawable/icon.png",
  "Assets/Plugins/Android/res/drawable/app_icon.png",
  "Assets/Plugins/Android/res/mipmap-hdpi/app_icon.png",
  "Assets/Plugins/Android/res/mipmap-mdpi/app_icon.png",
  "Assets/Plugins/Android/res/mipmap-xhdpi/app_icon.png",
  "Assets/Plugins/Android/res/mipmap-xxhdpi/app_icon.png",
  "Assets/Plugins/Android/res/mipmap-xxxhdpi/app_icon.png",
  "Assets/Art/icon.png",
  "Assets/Art/icon2.png",
  "Assets/UI/Dragon Tiger Icon.png"
];

const STATIC_FALLBACK_URLS = {
  "zey-win/plinko": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__plinko.png",
  "zey-win/SlotSpot": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__SlotSpot.png",
  "zey-win/Unstopable": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__Unstopable.png",
  "zey-win/wheel-of-fortune": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__wheel-of-fortune.png",
  "zey-win/blackjack": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__blackjack.png",
  "zey-win/baccarat-tiger": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__baccarat-tiger.png",
  "zey-win/roulette": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__roulette.png",
  "zey-win/dragon-tiger": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__dragon-tiger.png",
  "zey-win/android-builder-api": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__plinko.png",
  "zey-win/ci-cd": "https://zey-wingithubio.vercel.app/repo-icons/zey-win__plinko.png"
};

function encodeContentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizePath(value) {
  const path = safeString(value).replace(/^\.?\//, "");
  if (!path || path.includes("..") || !/^Assets\/[A-Za-z0-9_./ =()+-]+\.png$/i.test(path)) {
    return "";
  }
  return path;
}

function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === PNG_MAGIC;
}

function scoreIconPath(path) {
  const lower = path.toLowerCase();
  let score = 0;
  if (lower === "assets/zeywin/iconoverride/android-icon.png") score += 200;
  if (lower === "assets/art/icon.png") score += 190;
  if (lower === "assets/art/icon2.png") score += 185;
  if (lower === "assets/sprites/icon.png") score += 180;
  if (lower === "assets/ui/dragon tiger icon.png") score += 175;
  if (lower.includes("/appicon")) score += 120;
  if (lower.includes("/app_icon") || lower.includes("/app-icon")) score += 120;
  if (lower.includes("/launcher")) score += 110;
  if (/\/icon\.png$/.test(lower)) score += 100;
  if (lower.includes("/icons/")) score -= 30;
  if (lower.includes("/sprites/")) score += 25;
  if (lower.includes("/plugins/android/res/")) score += 20;
  if (lower.includes("textmesh pro/")) score -= 140;
  if (lower.includes("/editor/")) score -= 120;
  if (lower.includes("/loading/")) score -= 50;
  if (lower.includes("ad_icon")) score -= 100;
  if (lower.includes("infobutton")) score -= 200;
  if (lower.includes("clearbutton")) score -= 200;
  if (lower.includes("bebelbtn")) score -= 200;
  if (lower.includes("doubledownbtn")) score -= 200;
  if (lower.includes("/buttons/")) score -= 200;
  if (lower.includes("back.png")) score -= 200;
  if (lower.includes("settings")) score -= 100;
  if (lower.includes("/cloth/")) score -= 100;
  if (lower.includes("/roads/")) score -= 100;
  if (lower.includes("usericon")) score -= 100;
  return score;
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

async function fetchPngDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  if (blob.type && blob.type !== "image/png") return null;
  if (!blob.size || blob.size > MAX_PREVIEW_BYTES) return null;
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (!isPng(buffer)) return null;
  const base64 = buffer.toString("base64");
  return `data:image/png;base64,${base64}`;
}

async function readPngContent(repo, ref, path) {
  const encodedPath = encodeContentPath(path);
  const file = await githubFetch(`/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`);
  if (Array.isArray(file) || file.type !== "file" || !file.content) {
    return null;
  }

  const base64 = String(file.content || "").replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!isPng(buffer) || buffer.length > MAX_PREVIEW_BYTES) {
    return null;
  }

  return {
    path,
    sha: file.sha || "",
    size: buffer.length,
    htmlUrl: file.html_url || "",
    dataUrl: `data:image/png;base64,${base64}`
  };
}

async function listScoredTreeCandidates(repo, ref) {
  try {
    const tree = await githubFetch(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return (tree.tree || [])
      .filter((entry) => entry.type === "blob" && /\.png$/i.test(entry.path || "") && /^Assets\//.test(entry.path || ""))
      .map((entry) => entry.path)
      .map((path) => ({ path, score: scoreIconPath(path) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 18)
      .map((item) => item.path);
  } catch (error) {
    if (error.statusCode === 404) {
      return [];
    }
    throw error;
  }
}

async function findIcon(repo, ref, explicitPath) {
  const candidates = dedupe([
    normalizePath(explicitPath),
    ...STATIC_ICON_CANDIDATES,
    ...(await listScoredTreeCandidates(repo, ref))
  ]);

  for (const path of candidates) {
    try {
      const icon = await readPngContent(repo, ref, path);
      if (icon) {
        return icon;
      }
    } catch (error) {
      if (error.statusCode !== 404) {
        throw error;
      }
    }
  }

  // Fallback: if no icon found in repo, try static URL from zey-win.github.io repo-icons/
  const fallbackUrl = STATIC_FALLBACK_URLS[repo];
  if (fallbackUrl) {
    const dataUrl = await fetchPngDataUrl(fallbackUrl);
    if (dataUrl) {
      return { path: "Assets/Sprites/Icon.png", dataUrl, source: "static-fallback" };
    }
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method !== "GET") {
      sendJson(req, res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    requireOperator(req);

    const repo = safeString(req.query?.game_repository || req.query?.repository);
    const ref = safeString(req.query?.game_ref || req.query?.ref, "main");
    const explicitPath = safeString(req.query?.icon_path);
    assertRepo(repo);
    assertSimpleRef(ref);

    const icon = await findIcon(repo, ref, explicitPath);
    sendJson(req, res, 200, {
      ok: true,
      repository: repo,
      ref,
      found: Boolean(icon),
      icon
    });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, errorPayload(error));
  }
};