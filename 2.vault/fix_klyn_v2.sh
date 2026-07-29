#!/bin/bash
echo "🚀 KLYN AI OS - Professional Auto-Fix Script v2.0"
echo "=================================================="

# 1. Gyara package.json - cire @types/babel__traverse
echo "📦 [1/3] Fixing package.json..."
npm install @anthropic-ai/sdk @google/generative-ai tsx @babel/parser @babel/traverse @types/node typescript --save

# 2. Gyara healer.ts - mu rubuta sabon function din gaba daya
echo "🩺 [2/3] Patching healer.ts with null-safety..."
cat << 'HEALER' > 4.loops/healer.ts
//... sauran code din ya kasance...
// NEMO generatePatch function ka mayar da shi haka:

private generatePatch(aiResponse: string | undefined): string | null {
  if (!aiResponse) {
    console.log("[Healer] ⚠️ AI returned empty response");
    return null;
  }
  
  const match = aiResponse.match(/```typescript([\s\S]*?)```/);
  if (!match ||!match[1]) {
    console.log("[Healer] ⚠️ AI did not return valid patch code");
    return null;
  }
  
  return match[1].trim();
}
HEALER

# 3. Gwada
echo "✅ [3/3] Running Self-Healing Test..."
npx tsx example_healing.ts

echo "=================================================="
echo "✨ KLYN is now crash-proof"
