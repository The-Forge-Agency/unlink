#!/usr/bin/env bash
# Publie une nouvelle version : ./tools/release.sh 1.0.1
# Met à jour manifest.json, lance les vérifications, crée le commit et le tag vX.Y.Z, puis pousse.
# Le tag déclenche .github/workflows/release.yml (GitHub Release + envoi au Chrome Web Store).
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:?Usage : ./tools/release.sh X.Y.Z}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version invalide : $V (attendu : X.Y.Z)"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Des modifications ne sont pas commitées."; exit 1; }
node -e "const f='manifest.json',m=require('./'+f);m.version='$V';require('fs').writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
node -e "const f='package.json',m=require('./'+f);m.version='$V';require('fs').writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
npm run check
npm test
git add manifest.json package.json
git commit -m "Version $V"
git tag -a "v$V" -m "UnLink $V"
git push
git push origin "v$V"
echo "Tag v$V poussé : la publication est en cours sur GitHub Actions."
