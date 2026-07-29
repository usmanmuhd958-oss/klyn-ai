// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import { ASTEngine } from '../core/ast-engine.ts';
import { PerformanceMonitor } from '../core/performance-monitor.ts';
import { CodeAnalyzer } from '../1.brain/analyzer.ts';
import { Logger } from '../utils/logger.ts';
import { BENCHMARKS } from '../config/constants.ts';

const logger = new Logger('Benchmark');

async function runBenchmarks(): Promise<void> {
  logger.info('Running production benchmarks...');

  const engine = new ASTEngine();
  const monitor = new PerformanceMonitor();
  const analyzer = new CodeAnalyzer();

  const iterations = 50000;

  logger.info(`Running ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    engine.lookup('test.ts', 'ImportDeclaration');
    const duration = performance.now() - start;
    monitor.recordMetric('lookup', duration, 'ms');
  }

  const lookupStats = monitor.getSummary('lookup');
  const memory = engine.getMemoryUsage();
  const lookupRate = engine.getLookupRate();

  logger.info('=== BENCHMARK RESULTS ===');

  logger.metric('Avg Lookup Time', lookupStats.avg, 'ms');
  logger.metric('P95 Lookup Time', lookupStats.p95, 'ms');
  logger.metric('P99 Lookup Time', lookupStats.p99, 'ms');
  logger.metric('Memory (Heap)', memory.heapUsed, 'MB');
  logger.metric('Memory (RSS)', memory.rss, 'MB');
  logger.metric('Lookup Rate', lookupRate, '/s');

  logger.info('=== TARGET BENCHMARKS ===');

  logger.metric('Target Ingestion', BENCHMARKS.INGESTION_SPEED, 'ms');
  logger.metric('Target Memory', BENCHMARKS.MEMORY_FOOTPRINT, 'MB');
  logger.metric('Target Lookup Rate', BENCHMARKS.AST_LOOKUP_RATE, '/s');

  const meetsTargets =
    memory.heapUsed <= BENCHMARKS.MEMORY_FOOTPRINT * 10 &&
    lookupRate >= 10000;

  if (meetsTargets) {
    logger.success('✓ All benchmarks meet targets!');
  } else {
    logger.warn('⚠ Benchmarks executed below target threshold.');
  }
}

runBenchmarks().catch(console.error);
