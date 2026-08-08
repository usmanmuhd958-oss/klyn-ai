export class RuntimeMemory {
  private memory = new Map();

  store(key: string, value: unknown) {
    this.memory.set(key,value);
  }

  recall(key:string) {
    return this.memory.get(key);
  }
}
