const fs = require("node:fs");
const path = require("node:path");

for (const file of ["api/_shared.js", "api/health.js", "api/repos.js", "api/branches.js", "api/build.js", "api/cancel.js", "api/runs.js", "api/logs.js", "api/artifacts.js", "api/versions.js", "api/sdk-versions.js", "api/icon.js", "api/generate-icon.js"]) {
  const fullPath = path.join(process.cwd(), file);
  require(fullPath);
  console.log(`ok ${file}`);
}

const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
if (!vercel.functions) {
  throw new Error("vercel.json is missing functions.");
}
console.log("ok vercel.json");
