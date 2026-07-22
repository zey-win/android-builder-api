# ZeyWin Android Builder API

Dedicated Vercel backend for `https://zey-win.github.io/` Android build form.

It accepts form payloads from GitHub Pages, previews the current app icon from an allowed Unity game repository, optionally commits a selected PNG icon override, auto-fills the next AAB version from `zey-win/ci-cd`, then dispatches GitHub Actions.
It can also list game branches for app variants, generate a 512px launcher icon through OpenAI, and commit a selected Firebase `google-services.json` before dispatching the build.

Build requests can pass `signing_profile` as `playmax`, `slotspot`, or `playsocialgames`. The GitHub Actions workflow maps that value to the matching Android keystore secrets.

Required production environment variables:

- `GITHUB_TOKEN`: GitHub token with `repo` and `workflow` access.
- `ALLOWED_ORIGINS`: comma-separated origins, default `https://zey-win.github.io`.
- `ALLOWED_GAME_REPOS`: optional comma-separated game repos. If empty, the API lists and accepts every repository under `GITHUB_ORG`.
- `GITHUB_ORG`: default `zey-win`.
- `CI_REPOSITORY`: default `zey-win/ci-cd`.
- `CI_WORKFLOW`: default `build-apk.yml`.
- `CI_REF`: default `main`.
- `BUILDER_OPERATOR_KEY`: optional operator key. If set, clients must send `x-builder-key`.
- `OPENAI_API_KEY`: optional; required only for `/api/generate-icon`.
- `OPENAI_IMAGE_MODEL`: optional, defaults to `gpt-image-1`.
- `OPENAI_IMAGE_SIZE`: optional, defaults to `1024x1024`.

Visitor stats are stored in Vercel KV (`@vercel/kv`). Add the Vercel KV integration to your project for persistent visitor counts across serverless invocations.

Required GitHub Actions secrets in `CI_REPOSITORY`:

- `PRIVATE_REPO_TOKEN`
- `UNITY_LICENSE`
- `UNITY_EMAIL`
- `UNITY_PASSWORD`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASS`
- `ANDROID_KEYALIAS_NAME`
- `ANDROID_KEYALIAS_PASS`
- optional profile overrides: `PLAYSOCIALGAMES_ANDROID_*`, `SLOTSPOT_ANDROID_*`
- optional publishing: `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
