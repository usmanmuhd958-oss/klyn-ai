export class ASTEngine {
  private lookupCount: number = 0;
  private startTime: number = Date.now();

  public lookup(file: string, nodeType: string): void {
    this.lookupCount++;
  }

  public getMemoryUsage(): { heapUsed: number; rss: number } {
    const mem = process.memoryUsage();
    return {
      heapUsed: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
      rss: Number((mem.rss / 1024 / 1024).toFixed(2))
    };
  }

  public getLookupRate(): number {
    const elapsedSec = (Date.now() - this.startTime) / 1000 || 0.001;
    return Math.round(this.lookupCount / elapsedSec);
  }
}
