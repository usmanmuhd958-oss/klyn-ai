#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Fixing Klyn Studio Next.js 16 Webpack mode..."

if [ -f "package.json" ] && grep -q '"name": "klyn-web"' package.json; then
    WEB_DIR="$(pwd)"
elif [ -f "apps/web/package.json" ]; then
    WEB_DIR="$(pwd)/apps/web"
else
    echo "❌ Cannot find Klyn web package.json"
    exit 1
fi

echo "📍 Web directory: $WEB_DIR"

cd "$WEB_DIR"

node - <<'EOF'
const fs = require("fs");

const pkg = JSON.parse(fs.readFileSync("package.json","utf8"));

pkg.scripts = {
  ...pkg.scripts,
  dev: "next dev --webpack"
};

fs.writeFileSync(
  "package.json",
  JSON.stringify(pkg,null,2) + "\n"
);
EOF

echo "🧹 Removing Next cache..."
rm -rf .next

echo "✅ Webpack mode enabled."
echo ""
echo "Run:"
echo "npm run dev"
