const { getAllowedOrigins, getAllowedRepos, handleOptions, sendJson } = require("./_shared");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  sendJson(req, res, 200, {
    ok: true,
    service: "zeywin-android-builder-api",
    allowedOrigins: getAllowedOrigins(),
    allowedGameRepos: getAllowedRepos(),
    ciRepository: process.env.CI_REPOSITORY || "zey-win/ci-cd",
    ciWorkflow: process.env.CI_WORKFLOW || "build-apk.yml",
    ciRef: process.env.CI_REF || "main",
    operatorKeyRequired: Boolean(process.env.BUILDER_OPERATOR_KEY)
  });
};
