import { getLlamaMonitor } from './llama_monitor.js';

getLlamaMonitor();
console.log('LLM Monitor running...');
setInterval(() => {}, 3600000); // Keep process alive
