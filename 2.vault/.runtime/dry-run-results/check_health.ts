// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const { getManifest } = require('../kernel/src/observability/health_manifest');

const manifest = getManifest();

console.log('[HEALTH] Kernel Health Manifest:');
const snapshot = manifest.snapshot();

console.log('[HEALTH] System Health:', snapshot.systemHealth);
console.log('[HEALTH] Uptime:', Math.round(snapshot.uptimeMs / 1000), 'seconds');
console.log('[HEALTH] Components:');

for (const [componentId, component] of Object.entries(snapshot.components)) {
  const status = component.status;
  const critical = component.critical ? '[CRITICAL]' : '';
  console.log(`[HEALTH]   ${componentId}: ${status} ${critical}`);
  
  if (status === 'FAULTED' && component.critical) {
    console.error('[ERROR] Critical component is faulted:', componentId);
    process.exit(1);
  }
}

console.log('[SUCCESS] System health check passed');
process.exit(0);


export {};
