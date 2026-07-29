// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
export class Scheduler{
  [key: string]: any;queue=[];schedule(fn){this.queue.push(fn);setTimeout(fn,0)}}
