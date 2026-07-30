export interface MemoryContract {
  store(key: string, value: unknown): Promise<void>;

  retrieve(key: string): Promise<unknown | null>;

  search(query: string): Promise<unknown[]>;

  compress(): Promise<void>;
}
