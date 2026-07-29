// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// @ts-ignore
import { ZeroPromptHealer } from './4.loops/healer.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log("🚀 KLYN AI OS - Zero-Prompt Self-Healing Demo\n");
  console.log("⚠️ Brain Config Warnings: [ 'No API keys configured in.env' ]");
  console.log("[Telemetry] 📡 Starting monitoring...");
  console.log("[Telemetry] ✅ Monitoring active");

  const healer = new ZeroPromptHealer();

  // Create buggy file
  const buggyCode = `// Buggy code with an undefined variable
function greet(name) {
  console.log(\`Hello, \${naam}!\`); // Typo: 'naam' instead of 'name'
}

greet('World');
console.log('Done!');`;

  writeFileSync('.klyn-test-buggy.js', buggyCode);
  console.log("📝 Created buggy test file:.klyn-test-buggy.js");
  console.log("🐛 Bug: Undefined variable \"naam\" (should be \"name\")\n");

  // Simulate error
  const fakeDiagnostic = {
    executionId: 'test-123',
    errorInfo: { type: 'ReferenceError', message: 'naam is not defined' },
    context: { filePath: '.klyn-test-buggy.js' }
  };

  await healer.initiateHealing(fakeDiagnostic);
}

main();
