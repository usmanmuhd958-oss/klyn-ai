const { getEnhancedLLMMonitor, LLMRequest } = require('../kernel/src/services/llama_monitor');
const { createLogger } = require('../kernel/src/observability/logger');

const log = createLogger('DryRunTest');
const llmMonitor = getEnhancedLLMMonitor();

async function testLLMInference() {
  console.log('[TEST] LLM Monitor Inference Test');
  console.log('[TEST] Creating LLM request with local fallback enabled...');
  
  try {
    const request = new LLMRequest({
      prompt: 'Generate a simple Bash function that echoes "Hello KLYN"',
      taskType: 'GENERATE_CODE',
      allowLocalFallback: true,
      maxTokens: 500,
    });
    
    console.log('[TEST] Sending request to LLM Monitor...');
    
    const response = await llmMonitor.infer(request);
    
    console.log('[TEST] Response received:');
    console.log('[TEST]   Provider:', response.provider);
    console.log('[TEST]   Success:', response.success);
    console.log('[TEST]   Latency:', response.latencyMs, 'ms');
    console.log('[TEST]   Fallback used:', response.fallbackUsed);
    console.log('[TEST]   Content length:', response.content?.length || 0, 'chars');
    
    if (response.fallbackUsed) {
      console.log('[INFO] Local compilation fallback was triggered (expected on network issues)');
    }
    
    // Get monitor metrics
    const metrics = llmMonitor.getMetrics();
    console.log('[TEST] LLM Monitor Metrics:', JSON.stringify(metrics, null, 2));
    
    console.log('[SUCCESS] LLM Monitor test completed');
    process.exit(0);
    
  } catch (err) {
    console.error('[ERROR] LLM Monitor test failed:', err.message);
    console.error('[ERROR] Stack:', err.stack);
    process.exit(1);
  }
}

testLLMInference();


export {};
