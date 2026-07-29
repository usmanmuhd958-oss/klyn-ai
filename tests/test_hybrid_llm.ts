const monitor = require('../kernel/src/services/hybrid_llm_monitor').getHybridLLMMonitor();
setTimeout(() => {
    console.log('Best model:', monitor.getBestModel());
}, 3000);


export {};
