#!/usr/bin/env bash
# Construit le paquet à envoyer au Chrome Web Store : dist/unlink-<version>.zip (sans les outils de test).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
OUT="dist/unlink-${VERSION}.zip"
rm -f "$OUT"
zip -qr "$OUT" manifest.json icons src -x "*.DS_Store"
echo "Paquet : $OUT ($(du -h "$OUT" | cut -f1))"
