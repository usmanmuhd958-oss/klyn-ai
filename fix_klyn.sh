#!/bin/bash
echo "🚀 KLYN AI OS - Professional Auto-Fix Script v1.0"
echo "=================================================="

# 1. Gyara package.json dependencies
echo "📦 [1/3] Fixing package.json..."
npm install @anthropic-ai/sdk @google/generative-ai tsx @babel/parser @babel/traverse @types/node typescript --save

# 2. Gyara healer.ts - null safety patch
echo "🩺 [2/3] Patching healer.ts with null-safety..."
sed -i 's/const match = aiResponse.match(/const match = aiResponse?.match?.(/g' 4.loops/healer.ts
sed -i '/const match = aiResponse?.match?.(/a\ if (!match ||!match[1]) {\n console.log("[Healer] ⚠️ AI did not return valid patch code");\n return null;\n }' 4.loops/healer.ts

# 3. Gwada idan ya yi aiki
echo "✅ [3/3] Running Self-Healing Test..."
npx tsx example_healing.ts

echo "=================================================="
echo "✨ KLYN Self-Healing Loop is now SAFE"
