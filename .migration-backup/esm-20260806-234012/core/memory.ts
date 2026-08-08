import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface MemoryRecord {
  id: number;
  errorHash: string;
  errorText: string;
  filePath: string;
  fixCode: string;
  modelUsed: string;
  successCount: number;
  lastUsed: number;
  moneySaved: number;
}

export interface MemoryStats {
  totalBugsFixed: number;
  totalMoneySaved: number;
  ramFootprintMB: number;
  cacheSize: number;
  cacheHitRate?: number;
}

export class MemoryEngine {
  [key: string]: any;
  private cache: Map<string, MemoryRecord>;
  private dbPath: string;
  private klynDir: string;
  private nextId: number;
  private cacheHits: number;
  private cacheMisses: number;
  private writeQueue: NodeJS.Timeout | null;
  private pendingWrite: boolean;

  constructor(customPath?: string) {
    this.cache = new Map<string, MemoryRecord>();
    this.klynDir = customPath || join(homedir(), '.klyn');
    this.dbPath = join(this.klynDir, 'memory.json');
    this.nextId = 1;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.writeQueue = null;
    this.pendingWrite = false;

    this.initDatabase();
  }

  public initDatabase(): void {
    try {
      if (!existsSync(this.klynDir)) {
        mkdirSync(this.klynDir, { recursive: true, mode: 0o755 });
      }

      if (existsSync(this.dbPath)) {
        try {
          const rawData = readFileSync(this.dbPath, 'utf-8');

          if (rawData.trim().length === 0) {
            this.initializeEmptyDatabase();
            return;
          }

          const parsed = JSON.parse(rawData);

          if (Array.isArray((parsed as any).records)) {
            (parsed as any).records.forEach((record: MemoryRecord) => {
              this.cache.set((record as any).errorHash, record);
              if ((record as any).id >= this.nextId) {
                this.nextId = (record as any).id + 1;
              }
            });
          }

          if (typeof (parsed as any).nextId === 'number') {
            this.nextId = (parsed as any).nextId;
          }
        } catch (parseError) {
          console.warn('[MemoryEngine] Parse error, initializing fresh database:', parseError);
          this.initializeEmptyDatabase();
        }
      } else {
        this.initializeEmptyDatabase();
      }
    } catch (error) {
      console.error('[MemoryEngine] Init error (non-fatal):', error);
      this.cache = new Map<string, MemoryRecord>();
      this.nextId = 1;
    }
  }

  private initializeEmptyDatabase(): void {
    this.cache = new Map<string, MemoryRecord>();
    this.nextId = 1;
    this.persistToDisc();
  }

  public getCachedFix(errorHash: string): string | null {
    const record = this.cache.get(errorHash);

    if (record) {
      this.cacheHits++;
      (record as any).lastUsed = Date.now();
      (record as any).successCount++;
      this.scheduleDebouncedWrite();
      return (record as any).fixCode;
    }

    this.cacheMisses++;
    return null;
  }

  public findSimilarError(errorText: string): MemoryRecord | null {
    if (!errorText) return null;
    const cleanQuery = errorText.toLowerCase().trim();
    for (const record of this.cache.values()) {
      if (
        (record as any).errorText.toLowerCase().includes(cleanQuery) ||
        cleanQuery.includes((record as any).errorText.toLowerCase())
      ) {
        return record;
      }
    }
    return null;
  }

  public insertFix(
    errorHash: string,
    errorText: string,
    filePath: string,
    fixCode: string,
    modelUsed: string,
    moneySaved: number = 0.02
  ): void {
    try {
      const existingRecord = this.cache.get(errorHash);

      if (existingRecord) {
        existingRecord.errorText = this.sanitizeString(errorText);
        existingRecord.filePath = this.sanitizeString(filePath);
        existingRecord.fixCode = this.sanitizeString(fixCode);
        existingRecord.modelUsed = this.sanitizeString(modelUsed);
        existingRecord.lastUsed = Date.now();
        existingRecord.moneySaved += moneySaved;
      } else {
        const newRecord: MemoryRecord = {
          id: this.nextId++,
          errorHash: this.sanitizeString(errorHash),
          errorText: this.sanitizeString(errorText),
          filePath: this.sanitizeString(filePath),
          fixCode: this.sanitizeString(fixCode),
          modelUsed: this.sanitizeString(modelUsed),
          successCount: 1,
          lastUsed: Date.now(),
          moneySaved,
        };

        this.cache.set(errorHash, newRecord);
      }

      this.persistToDisc();
    } catch (error) {
      console.error('[MemoryEngine] Insert error (non-fatal):', error);
    }
  }

  public getStats(): MemoryStats {
    let totalBugsFixed = 0;
    let totalMoneySaved = 0;

    this.cache.forEach((record: MemoryRecord) => {
      totalBugsFixed += (record as any).successCount;
      totalMoneySaved += (record as any).moneySaved;
    });

    const cacheSize = this.cache.size;
    const ramFootprintMB = this.calculateRamFootprint();
    const totalRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate =
      totalRequests > 0 ? parseFloat(((this.cacheHits / totalRequests) * 100).toFixed(2)) : 0;

    return {
      totalBugsFixed,
      totalMoneySaved: parseFloat(totalMoneySaved.toFixed(4)),
      ramFootprintMB: parseFloat(ramFootprintMB.toFixed(2)),
      cacheSize,
      cacheHitRate,
    };
  }

  public async initialize(): Promise<void> {
    return Promise.resolve();
  }

  public async verifySchema(): Promise<boolean> {
    try {
      return this.cache instanceof Map && existsSync(this.klynDir);
    } catch {
      return false;
    }
  }

  public async storeErrorFix(
    errorHash: string,
    errorText: string,
    fixSnippet: string,
    modelDetails: Record<string, unknown>
  ): Promise<void> {
    const modelUsed = typeof modelDetails.model === 'string' ? modelDetails.model : 'unknown';
    const moneySaved = typeof modelDetails.moneySaved === 'number' ? modelDetails.moneySaved : 0.02;

    this.insertFix(errorHash, errorText, 'runtime', fixSnippet, modelUsed, moneySaved);
    return Promise.resolve();
  }

  public async retrieveFix(errorHash: string): Promise<{ fixSnippet: string } | null> {
    const fix = this.getCachedFix(errorHash);
    return fix ? { fixSnippet: fix } : null;
  }

  public async close(): Promise<void> {
    if (this.writeQueue) {
      clearTimeout(this.writeQueue);
      this.writeQueue = null;
    }
    this.persistToDisc();
    return Promise.resolve();
  }

  private sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return String(input);
    }

    return input.replace(/\u0000/g, '').replace(/\ufffd/g, '');
  }

  private scheduleDebouncedWrite(): void {
    if (this.writeQueue) {
      clearTimeout(this.writeQueue);
    }

    this.writeQueue = setTimeout(() => {
      this.persistToDisc();
      this.writeQueue = null;
    }, 500);
  }

  private persistToDisc(): void {
    if (this.pendingWrite) {
      return;
    }

    this.pendingWrite = true;

    try {
      const records = Array.from(this.cache.values());
      const data = {
        version: '1.0.0',
        lastUpdated: Date.now(),
        nextId: this.nextId,
        records,
      };

      const jsonString = JSON.stringify(data, null, 2);
      const tempPath = `${this.dbPath}.tmp`;

      writeFileSync(tempPath, jsonString, { encoding: 'utf-8', mode: 0o644 });

      if (existsSync(this.dbPath)) {
        const backupPath = `${this.dbPath}.bak`;
        try {
          writeFileSync(backupPath, readFileSync(this.dbPath, 'utf-8'), { encoding: 'utf-8' });
        } catch (backupError) {
          // Non-fatal backup error
        }
      }

      try {
        renameSync(tempPath, this.dbPath);
      } catch (renameError) {
        writeFileSync(this.dbPath, jsonString, { encoding: 'utf-8', mode: 0o644 });

        if (existsSync(tempPath)) {
          try {
            unlinkSync(tempPath);
          } catch {
            // Non-fatal cleanup error
          }
        }
      }
    } catch (error) {
      console.error('[MemoryEngine] Persist error (non-fatal):', error);
    } finally {
      this.pendingWrite = false;
    }
  }

  private calculateRamFootprint(): number {
    let totalBytes = 0;

    this.cache.forEach((record: MemoryRecord) => {
      totalBytes += (record as any).errorHash.length * 2;
      totalBytes += (record as any).errorText.length * 2;
      totalBytes += (record as any).filePath.length * 2;
      totalBytes += (record as any).fixCode.length * 2;
      totalBytes += (record as any).modelUsed.length * 2;
      totalBytes += 32;
    });

    return totalBytes / (1024 * 1024);
  }

  public clearCache(): void {
    this.cache.clear();
    this.nextId = 1;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.persistToDisc();
  }

  public exportRecords(): MemoryRecord[] {
    return Array.from(this.cache.values());
  }

  public importRecords(records: MemoryRecord[]): void {
    try {
      records.forEach((record: MemoryRecord) => {
        this.cache.set((record as any).errorHash, record);
        if ((record as any).id >= this.nextId) {
          this.nextId = (record as any).id + 1;
        }
      });
      this.persistToDisc();
    } catch (error) {
      console.error('[MemoryEngine] Import error (non-fatal):', error);
    }
  }
}

export const memoryEngine = new MemoryEngine();

// Top-level named exports required by healer.ts and other sub-modules
export const saveMemory = (
  errorHash: string,
  errorText: string,
  filePath: string,
  fixCode: string,
  modelUsed: string = 'sonnet',
  moneySaved?: number
) => memoryEngine.insertFix(errorHash, errorText, filePath, fixCode, modelUsed, moneySaved);

export const getMemory = (errorHash: string) => memoryEngine.getCachedFix(errorHash);

export const findSimilarError = (errorText: string) => memoryEngine.findSimilarError(errorText);

export default memoryEngine;

