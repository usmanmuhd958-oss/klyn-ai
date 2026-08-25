#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Fixing Klyn Studio Next.js 16 Termux Android Turbopack issue..."

WEB_DIR="$(pwd)/apps/web"

if [ ! -d "$WEB_DIR" ]; then
  echo "❌ apps/web directory not found: $WEB_DIR"
  exit 1
fi

cd "$WEB_DIR"

cat << 'EOF' > package.json
{
  "name": "klyn-web",
  "private": true,
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@xyflow/react": "^12.3.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.468.0",
    "next": "16.3.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
EOF

echo "🧹 Cleaning Next.js cache..."
rm -rf .next

echo "📦 Refreshing dependencies..."
npm install

echo ""
echo "✅ Klyn Studio fixed."
echo ""
echo "Start with:"
echo "npm run dev"
