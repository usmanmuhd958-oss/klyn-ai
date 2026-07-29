// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const { getCognitiveRouter } = require('../kernel/src/routing/cognitive_router');
const { createLogger } = require('../kernel/src/observability/logger');

const log = createLogger('DryRunTest');
const router = getCognitiveRouter();

async function testTaskDispatch() {
  console.log('[TEST] Cognitive Router Task Dispatch Test');
  console.log('[TEST] Enqueueing test task...');
  
  try {
    // Enqueue a test task
    router.enqueueTask({
      taskType: 'SCAN_FILE',
      payload: {
        filePath: process.env.TEST_TARGET_FILE,
        reason: 'Dry run test',
      },
      priority: 50,
      correlId: 'dry-run-test-001',
    });
    
    console.log('[TEST] Task enqueued successfully');
    
    // Get router metrics
    const metrics = router.getMetrics();
    console.log('[TEST] Router Metrics:', JSON.stringify(metrics, null, 2));
    
    // Success
    console.log('[SUCCESS] Cognitive Router test completed');
    process.exit(0);
    
  } catch (err) {
    console.error('[ERROR] Cognitive Router test failed:', err.message);
    process.exit(1);
  }
}

testTaskDispatch();


export {};
