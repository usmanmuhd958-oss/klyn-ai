export class RuntimeMetrics {

  collect(){

    const memory = process.memoryUsage();

    return {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      uptime: process.uptime()
    };

  }

}
