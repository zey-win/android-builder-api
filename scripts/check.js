const fs = require("node:fs");
const path = require("node:path");

for (const file of ["api/_shared.js", "api/health.js", "api/repos.js", "api/build.js", "api/runs.js", "api/logs.js", "api/artifacts.js"]) {
  const fullPath = path.join(process.cwd(), file);
  require(fullPath);
  console.log(`ok ${file}`);
}

const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
if (!vercel.functions) {
  throw new Error("vercel.json is missing functions.");
}
console.log("ok vercel.json");
