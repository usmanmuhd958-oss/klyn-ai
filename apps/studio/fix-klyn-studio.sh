#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "🔧 Fixing KLYN Studio..."

# Fix next.config.ts
cat <<'CONF' > next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,

  webpack(config) {
    return config;
  },
};

export default nextConfig;
CONF

echo "✅ next.config.ts fixed"

# Ensure lucide-react exists
npm install lucide-react

echo "✅ lucide-react installed"

# Clean Next cache
rm -rf .next

echo "✅ Next cache cleared"

echo ""
echo "🚀 Starting KLYN Studio..."
npm run dev
