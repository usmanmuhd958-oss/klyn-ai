// =============================================================================
// KLYN AI OS — Shell Slot Pool (Phase 2)
// File: 2.body/pool/pool.ts
//
// Owns a bounded set of long-lived ShellSlots, grouped by working directory.
// `acquire()` prefers an idle healthy slot bound to the same cwd; spawns a new
// slot up to the cap; and parks callers on a FIFO waiter queue when the pool
// is saturated. Dead slots are purged on touch and replaced lazily.
// =============================================================================

import { ShellSlot } from './shell-slot.js';

export interface ShellPoolOptions {
  maxSlots?: number;
  shell?: string;
}

const DEFAULT_MAX_SLOTS = 4;

export class ShellPool {
  private slots: ShellSlot[] = [];
  private freeIds = new Set<string>();
  private waiters: Array<(slot: ShellSlot) => void> = [];
  private totalSpawns = 0;

  constructor(private options: ShellPoolOptions = {}) {}

  private get maxSlots(): number {
    return this.options.maxSlots ?? DEFAULT_MAX_SLOTS;
  }

  /** Acquire a healthy idle slot for the given working directory. */
  async acquire(cwd: string): Promise<ShellSlot> {
    this.purgeDead();

    for (const id of this.freeIds) {
      const slot = this.slots.find((s) => s.id === id);
      if (slot && slot.workingDirectory === cwd && slot.isHealthy()) {
        this.freeIds.delete(id);
        slot.markBusy();
        return slot;
      }
    }

    if (this.slots.length < this.maxSlots) {
      return this.spawnSlot(cwd);
    }

    // Pool saturated — park on the FIFO waiter queue.
    return new Promise<ShellSlot>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Return a slot to the pool, or hand it straight to a waiting caller. */
  release(slot: ShellSlot): void {
    const waiter = this.waiters.shift();

    if (waiter) {
      if (!slot.isHealthy()) {
        this.purgeSlot(slot);
        slot = this.spawnSlot(slot.workingDirectory);
      }
      slot.markBusy();
      waiter(slot);
      return;
    }

    if (!slot.isHealthy()) {
      this.purgeSlot(slot);
      return;
    }

    slot.markIdle();
    this.freeIds.add(slot.id);
  }

  getStats(): {
    slots: number;
    free: number;
    busy: number;
    totalSpawns: number;
    waiters: number;
    byCwd: Record<string, number>;
  } {
    const byCwd: Record<string, number> = {};
    for (const s of this.slots) {
      byCwd[s.workingDirectory] = (byCwd[s.workingDirectory] ?? 0) + 1;
    }
    return {
      slots: this.slots.length,
      free: this.freeIds.size,
      busy: this.slots.length - this.freeIds.size,
      totalSpawns: this.totalSpawns,
      waiters: this.waiters.length,
      byCwd,
    };
  }

  /** Kill every slot. Safe to call on shutdown; slots are recreated on demand. */
  async dispose(): Promise<void> {
    for (const slot of this.slots) {
      slot.dispose();
    }
    this.slots = [];
    this.freeIds.clear();
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private spawnSlot(cwd: string): ShellSlot {
    const slot = ShellSlot.create({
      workingDirectory: cwd,
      shell: this.options.shell,
    });
    this.slots.push(slot);
    this.totalSpawns++;
    slot.markBusy();
    return slot;
  }

  private purgeDead(): void {
    for (const slot of this.slots) {
      if (!slot.isHealthy()) this.purgeSlot(slot);
    }
  }

  private purgeSlot(slot: ShellSlot): void {
    this.freeIds.delete(slot.id);
    const idx = this.slots.indexOf(slot);
    if (idx !== -1) this.slots.splice(idx, 1);
    slot.dispose();
  }
}

export default ShellPool;
