// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
export class Logger {
  private scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  public info(message: string): void {
    console.log(`[${this.scope}] ${message}`);
  }

  public success(message: string): void {
    console.log(`\x1b[32m[${this.scope}] ${message}\x1b[0m`);
  }

  public warn(message: string): void {
    console.log(`\x1b[33m[${this.scope}] ${message}\x1b[0m`);
  }

  public error(message: string): void {
    console.log(`\x1b[31m[${this.scope}] ${message}\x1b[0m`);
  }

  public metric(label: string, value: number | string, unit: string = ''): void {
    console.log(`  ${label.padEnd(22)}: \x1b[33m${value} ${unit}\x1b[0m`);
  }
}
