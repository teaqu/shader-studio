#!/usr/bin/env bash
# Combines the built docs (site/) and web app (standalone/dist/) into public/,
# the layout served at the site root and inside each pull request preview.
set -euo pipefail

rm -rf public
mkdir -p public/docs public/app
cp -r site/. public/docs/
cp -r standalone/dist/. public/app/
cat > public/index.html <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>Shader Studio</title>
<meta http-equiv="refresh" content="0; url=./app/">
<link rel="canonical" href="https://teaqu.github.io/shader-studio/app/">
<p>Redirecting to <a href="./app/">Shader Studio Web</a>…</p>
HTML
