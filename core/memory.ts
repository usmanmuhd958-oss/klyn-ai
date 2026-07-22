/**
 * memory.ts - SQLite Memory Layer for Self-Healing Engine
 * 
 * This is what makes KLYN 1000 years ahead of Cursor.
 * Cursor forgets. KLYN learns.
 * 
 * Features:
 * - Fuzzy matching for similar errors (>90% similarity)
 * - Success rate tracking per fix
 * - Cost savings calculation
 * - Auto-learning from every heal
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

// ========== INTERFACES ==========

export interface BugRecord {
  id?: number
  errorHash: string
  errorText: string
  filePath: string
  fixCode: string
  modelUsed: string
  successCount: number
  failCount: number
  lastUsed: number
}

export interface MemoryFix {
  fix: string
  successRate: number
  modelUsed: string
  timesUsed: number
  lastUsed: number
}

export interface MemoryStats {
  totalHeals: number
  successRate: number
  moneySaved: number
  cacheHitRate: number
  avgHealTime: number
  topModels: Array<{ model: string; count: number }>
}

export interface SaveMemoryParams {
  errorHash: string
  errorMessage: string
  filePath: string
  fix: string
  modelUsed: string
  success: boolean
  timeTaken: number
  timestamp: number
  successRate: number
}

// ========== CONSTANTS ==========

const DB_DIR = path.join(process.cwd(), '.klyn')
const DB_PATH = path.join(DB_DIR, 'memory.db')

// Cost per 1M tokens (USD)
const MODEL_COSTS = {
  'deepseek-v4': 0.27,      // $0.27/1M tokens
  'fable-5': 15.0,          // $15/1M tokens (expensive but smart)
  'gpt-4': 30.0,
  'claude-3-opus': 15.0,
  'default': 5.0
}

const AVG_TOKENS_PER_HEAL = 3000 // Average tokens used per AI heal

// ========== MEMORY CLASS ==========

export class Memory {
  private db: Database.Database
  private healTimings: Map<string, number> = new Map()

  constructor(dbPath: string = DB_PATH) {
    // Ensure .klyn directory exists
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log('📁 Created .klyn directory')
    }

    // Initialize SQLite database
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL') // Better concurrency
    this.db.pragma('synchronous = NORMAL') // Faster writes
    
    this.initializeTables()
    console.log('💾 Memory database initialized')
  }

  /**
   * Create tables on first run
   */
  private initializeTables(): void {
    // Main bugs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bugs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_hash TEXT UNIQUE NOT NULL,
        error_text TEXT NOT NULL,
        file_path TEXT NOT NULL,
        fix_code TEXT NOT NULL,
        model_used TEXT NOT NULL,
        success_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        last_used INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `)

    // Index for faster lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_error_hash ON bugs(error_hash)
    `)
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_last_used ON bugs(last_used DESC)
    `)

    // Metadata table for statistics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS heal_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_hash TEXT NOT NULL,
        model_used TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        time_taken INTEGER NOT NULL,
        from_cache BOOLEAN DEFAULT 0,
        timestamp INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON heal_stats(timestamp DESC)
    `)
  }

  /**
   * Find similar fix using fuzzy matching
   * Returns fix only if similarity > 0.9
   */
  public getSimilarFix(errorText: string): MemoryFix | null {
    const normalizedError = this.normalizeError(errorText)
    
    // First try exact hash match
    const hash = this.hashError(normalizedError)
    const exactMatch = this.db.prepare(`
      SELECT fix_code, model_used, success_count, fail_count, last_used
      FROM bugs
      WHERE error_hash = ?
    `).get(hash) as any

    if (exactMatch) {
      const totalUses = exactMatch.success_count + exactMatch.fail_count
      const successRate = totalUses > 0 ? exactMatch.success_count / totalUses : 0

      return {
        fix: exactMatch.fix_code,
        successRate,
        modelUsed: exactMatch.model_used,
        timesUsed: totalUses,
        lastUsed: exactMatch.last_used
      }
    }

    // Fuzzy matching - get all bugs and compare
    const allBugs = this.db.prepare(`
      SELECT error_text, fix_code, model_used, success_count, fail_count, last_used
      FROM bugs
      WHERE success_count > 0
      ORDER BY (success_count * 1.0 / (success_count + fail_count + 1)) DESC
      LIMIT 100
    `).all() as any[]

    let bestMatch: MemoryFix | null = null
    let bestSimilarity = 0

    for (const bug of allBugs) {
      const similarity = this.calculateSimilarity(normalizedError, this.normalizeError(bug.error_text))
      
      if (similarity > bestSimilarity && similarity > 0.9) {
        const totalUses = bug.success_count + bug.fail_count
        const successRate = totalUses > 0 ? bug.success_count / totalUses : 0

        if (successRate > 0.9) { // Only return if both similarity AND success rate > 90%
          bestSimilarity = similarity
          bestMatch = {
            fix: bug.fix_code,
            successRate,
            modelUsed: bug.model_used,
            timesUsed: totalUses,
            lastUsed: bug.last_used
          }
        }
      }
    }

    if (bestMatch) {
      console.log(`   💡 Fuzzy match found (${(bestSimilarity * 100).toFixed(1)}% similar)`)
    }

    return bestMatch
  }

  /**
   * Save fix to memory with success/fail tracking
   */
  public saveFix(errorText: string, fixCode: string, filePath: string, model: string, success: boolean): void {
    const normalizedError = this.normalizeError(errorText)
    const hash = this.hashError(normalizedError)
    const timestamp = Date.now()

    // Check if bug already exists
    const existing = this.db.prepare(`
      SELECT id, success_count, fail_count FROM bugs WHERE error_hash = ?
    `).get(hash) as any

    if (existing) {
      // Update existing record
      const newSuccessCount = existing.success_count + (success ? 1 : 0)
      const newFailCount = existing.fail_count + (success ? 0 : 1)

      this.db.prepare(`
        UPDATE bugs 
        SET success_count = ?,
            fail_count = ?,
            last_used = ?,
            updated_at = ?,
            fix_code = ?,
            model_used = ?
        WHERE error_hash = ?
      `).run(newSuccessCount, newFailCount, timestamp, timestamp, fixCode, model, hash)
    } else {
      // Insert new record
      this.db.prepare(`
        INSERT INTO bugs (error_hash, error_text, file_path, fix_code, model_used, success_count, fail_count, last_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(hash, errorText, filePath, fixCode, model, success ? 1 : 0, success ? 0 : 1, timestamp)
    }

    // Record in stats table
    this.db.prepare(`
      INSERT INTO heal_stats (error_hash, model_used, success, time_taken, from_cache, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(hash, model, success ? 1 : 0, 0, 0, timestamp)
  }

  /**
   * Update timing for a heal
   */
  public recordHealTime(errorHash: string, timeTaken: number, fromCache: boolean): void {
    this.db.prepare(`
      UPDATE heal_stats
      SET time_taken = ?, from_cache = ?
      WHERE error_hash = ? AND timestamp = (
        SELECT MAX(timestamp) FROM heal_stats WHERE error_hash = ?
      )
    `).run(timeTaken, fromCache ? 1 : 0, errorHash, errorHash)
  }

  /**
   * Get comprehensive statistics
   */
  public getStats(): MemoryStats {
    // Total heals
    const totalHeals = (this.db.prepare(`
      SELECT COUNT(*) as count FROM heal_stats
    `).get() as any).count

    // Success rate
    const successData = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(*) as total
      FROM heal_stats
    `).get() as any

    const successRate = successData.total > 0 ? successData.successes / successData.total : 0

    // Cache hit rate
    const cacheData = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN from_cache = 1 THEN 1 ELSE 0 END) as cache_hits,
        COUNT(*) as total
      FROM heal_stats
    `).get() as any

    const cacheHitRate = cacheData.total > 0 ? cacheData.cache_hits / cacheData.total : 0

    // Money saved by using cache
    const cacheHits = cacheData.cache_hits || 0
    const aiHeals = (cacheData.total || 0) - cacheHits

    // Calculate costs
    const modelUsage = this.db.prepare(`
      SELECT model_used, COUNT(*) as count
      FROM heal_stats
      WHERE from_cache = 0
      GROUP BY model_used
    `).all() as any[]

    let totalAICost = 0
    for (const usage of modelUsage) {
      const costPer1M = MODEL_COSTS[usage.model_used as keyof typeof MODEL_COSTS] || MODEL_COSTS.default
      const cost = (usage.count * AVG_TOKENS_PER_HEAL / 1_000_000) * costPer1M
      totalAICost += cost
    }

    // Money saved = cache hits * average cost per AI heal
    const avgCostPerHeal = aiHeals > 0 ? totalAICost / aiHeals : MODEL_COSTS.default * AVG_TOKENS_PER_HEAL / 1_000_000
    const moneySaved = cacheHits * avgCostPerHeal

    // Average heal time
    const avgTimeData = this.db.prepare(`
      SELECT AVG(time_taken) as avg_time FROM heal_stats WHERE time_taken > 0
    `).get() as any

    const avgHealTime = avgTimeData.avg_time || 0

    // Top models
    const topModels = this.db.prepare(`
      SELECT model_used as model, COUNT(*) as count
      FROM heal_stats
      GROUP BY model_used
      ORDER BY count DESC
      LIMIT 5
    `).all() as any[]

    return {
      totalHeals,
      successRate,
      moneySaved,
      cacheHitRate,
      avgHealTime,
      topModels
    }
  }

  /**
   * Normalize error text for better matching
   */
  private normalizeError(errorText: string): string {
    return errorText
      .toLowerCase()
      .replace(/['"]/g, '') // Remove quotes
      .replace(/\d+/g, 'N') // Replace numbers with N
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s]/g, '') // Remove special chars
      .trim()
  }

  /**
   * Hash error for unique identification
   */
  private hashError(normalizedError: string): string {
    let hash = 0
    for (let i = 0; i < normalizedError.length; i++) {
      const char = normalizedError.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns value between 0 and 1 (1 = identical)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2
    const shorter = str1.length > str2.length ? str2 : str1

    if (longer.length === 0) return 1.0

    const distance = this.levenshteinDistance(longer, shorter)
    return (longer.length - distance) / longer.length
  }

  /**
   * Levenshtein distance algorithm
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = []

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i]
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          )
        }
      }
    }

    return matrix[str2.length][str1.length]
  }

  /**
   * Clean up old unsuccessful entries (keep DB lean)
   */
  public cleanup(daysOld: number = 30): void {
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000)
    
    const deleted = this.db.prepare(`
      DELETE FROM bugs
      WHERE last_used < ?
      AND success_count = 0
      AND fail_count > 2
    `).run(cutoffTime)

    if ((deleted as any).changes > 0) {
      console.log(`🧹 Cleaned up ${(deleted as any).changes} old failed fixes`)
    }
  }

  /**
   * Export memory as JSON for backup
   */
  public export(): BugRecord[] {
    return this.db.prepare(`
      SELECT * FROM bugs ORDER BY last_used DESC
    `).all() as BugRecord[]
  }

  /**
   * Import memory from backup
   */
  public import(records: BugRecord[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO bugs 
      (error_hash, error_text, file_path, fix_code, model_used, success_count, fail_count, last_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((bugs: BugRecord[]) => {
      for (const bug of bugs) {
        insert.run(
          bug.errorHash,
          bug.errorText,
          bug.filePath,
          bug.fixCode,
          bug.modelUsed,
          bug.successCount,
          bug.failCount,
          bug.lastUsed
        )
      }
    })

    insertMany(records)
    console.log(`📥 Imported ${records.length} memory records`)
  }

  /**
   * Close database connection
   */
  public close(): void {
    this.db.close()
  }
}

// ========== SINGLETON INSTANCE ==========

let memoryInstance: Memory | null = null

export function getMemory(): Memory {
  if (!memoryInstance) {
    memoryInstance = new Memory()
  }
  return memoryInstance
}

// ========== HELPER FUNCTIONS FOR HEALER ==========

/**
 * Find similar error and return fix
 */
export async function findSimilarError(errorHash: string, errorText: string): Promise<MemoryFix | null> {
  const memory = getMemory()
  return memory.getSimilarFix(errorText)
}

/**
 * Save fix to memory
 */
export async function saveMemory(params: SaveMemoryParams): Promise<void> {
  const memory = getMemory()
  
  memory.saveFix(
    params.errorMessage,
    params.fix,
    params.filePath,
    params.modelUsed,
    params.success
  )

  // Record timing
  if (params.timeTaken) {
    memory.recordHealTime(params.errorHash, params.timeTaken, params.modelUsed === 'memory')
  }
}

/**
 * Get memory statistics
 */
export function getMemoryStats(): MemoryStats {
  const memory = getMemory()
  return memory.getStats()
}

/**
 * Print beautiful stats to console
 */
export function printStats(): void {
  const stats = getMemoryStats()
  
  console.log('\n╔═══════════════════════════════════════════════════╗')
  console.log('║        KLYN MEMORY STATS - 1000 YEARS AHEAD       ║')
  console.log('╠═══════════════════════════════════════════════════╣')
  console.log(`║  Total Heals:       ${String(stats.totalHeals).padEnd(30)} ║`)
  console.log(`║  Success Rate:      ${(stats.successRate * 100).toFixed(1)}%${' '.repeat(26)} ║`)
  console.log(`║  Cache Hit Rate:    ${(stats.cacheHitRate * 100).toFixed(1)}%${' '.repeat(26)} ║`)
  console.log(`║  Money Saved:       $${stats.moneySaved.toFixed(2)}${' '.repeat(27 - stats.moneySaved.toFixed(2).length)} ║`)
  console.log(`║  Avg Heal Time:     ${stats.avgHealTime.toFixed(0)}ms${' '.repeat(26 - stats.avgHealTime.toFixed(0).length)} ║`)
  console.log('╠═══════════════════════════════════════════════════╣')
  console.log('║  Top Models:                                      ║')
  
  for (const model of stats.topModels) {
    const modelStr = `${model.model}: ${model.count}`
    console.log(`║    ${modelStr}${' '.repeat(47 - modelStr.length)}║`)
  }
  
  console.log('╚═══════════════════════════════════════════════════╝\n')
  console.log('💡 Cursor forgets. KLYN learns. This is the future.\n')
}

// ========== AUTO-CLEANUP ==========

// Run cleanup weekly
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    try {
      getMemory().cleanup(30)
    } catch (error) {
      // Silent fail
    }
  }, 7 * 24 * 60 * 60 * 1000) // 7 days
}

// ========== EXPORTS ==========

export default Memory
