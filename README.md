# ZeyWin Android Builder API

Dedicated Vercel backend for `https://zey-win.github.io/` Android build form.

It accepts form payloads from GitHub Pages, optionally commits a selected PNG icon into an allowed Unity game repository, then dispatches `zey-win/ci-cd` GitHub Actions.

Required production environment variables:

- `GITHUB_TOKEN`: GitHub token with `repo` and `workflow` access.
- `ALLOWED_ORIGINS`: comma-separated origins, default `https://zey-win.github.io`.
- `ALLOWED_GAME_REPOS`: optional comma-separated game repos. If empty, the API lists and accepts every repository under `GITHUB_ORG`.
- `GITHUB_ORG`: default `zey-win`.
- `CI_REPOSITORY`: default `zey-win/ci-cd`.
- `CI_WORKFLOW`: default `build-apk.yml`.
- `CI_REF`: default `main`.
- `BUILDER_OPERATOR_KEY`: optional operator key. If set, clients must send `x-builder-key`.
