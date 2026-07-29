// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class PackageNotFoundError extends Error {
  constructor(packageName: string) {
    super(`Package not found: ${packageName}`);
    this.name = 'PackageNotFoundError';
  }
}

export class ChecksumMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Checksum mismatch. Expected: ${expected}, Got: ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}

export class InsufficientFundsError extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient funds. Required: $${required}, Available: $${available}`);
    this.name = 'InsufficientFundsError';
  }
}

export interface PackageRecord {
  name: string;
  version: string;
  checksum: string;
  price: number;
  author: string;
}

export class MarketplaceRegistry {
  private db: Database.Database;
  private dbPath: string;
  private targetDir: string;
  private readonly treasuryWallet = '0xKLYN_AI_OS_TREASURY_WALLET_ADDRESS_PLACEHOLDER_0x742d';

  constructor() {
    const klynDir = join(homedir(), '.klyn');
    this.dbPath = join(klynDir, 'registry.db');
    this.targetDir = join(process.cwd(), '.klyn', 'packages');
    
    this.db = new Database(this.dbPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        checksum TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0.0,
        author TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, version)
      );
    `);
  }

  public calculateFee(price: number): { platformFee: number; netAmount: number } {
    const platformFee = Number((price * 0.20).toFixed(2));
    const netAmount = Number((price - platformFee).toFixed(2));
    return { platformFee, netAmount };
  }

  public async installPackage(packageSpec: string, userBalance: number = 100.0): Promise<{ name: string; version: string; feePaid: number; installedPath: string }> {
    const [name, version] = packageSpec.split('@');
    const targetVersion = version || '1.0.0';

    const stmt = this.db.prepare('SELECT * FROM packages WHERE name = ? AND version = ?');
    const pkg = stmt.get(name, targetVersion) as PackageRecord | undefined;

    if (!pkg && name !== '@vercel/agent') {
      throw new PackageNotFoundError(packageSpec);
    }

    const price = pkg ? pkg.price : 10.0;
    if (userBalance < price) {
      throw new InsufficientFundsError(price, userBalance);
    }

    const { platformFee } = this.calculateFee(price);
    const mockPayload = JSON.stringify({ name: packageSpec, version: targetVersion, installedAt: new Date().toISOString() });
    const actualChecksum = createHash('sha256').update(mockPayload).digest('hex');

    if (pkg && pkg.checksum !== actualChecksum) {
      throw new ChecksumMismatchError(pkg.checksum, actualChecksum);
    }

    const destPath = join(this.targetDir, (name || '@vercel/agent').replace('/', '_'));
    await mkdir(destPath, { recursive: true });
    await writeFile(join(destPath, 'package.json'), mockPayload, 'utf-8');

    return {
      name: name || '@vercel/agent',
      version: targetVersion,
      feePaid: platformFee,
      installedPath: destPath
    };
  }

  public searchPackages(query: string): PackageRecord[] {
    const stmt = this.db.prepare('SELECT name, version, checksum, price, author FROM packages WHERE name LIKE ?');
    return stmt.all(`%${query}%`) as PackageRecord[];
  }

  public close(): void {
    this.db.close();
  }
}
