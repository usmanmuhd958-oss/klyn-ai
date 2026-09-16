/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — SPSC Ring Buffer (TypeScript reference)
 * File: genesis/v670/ipc/ring-buffer.ts
 * Version: 1.0.0
 *
 * A lock-free-style single-producer / single-consumer ring buffer. This is the
 * TypeScript reference implementation of `0.kernel/src/ringbuf.rs` (the Rust
 * heart) so the semantics are identical and testable in pure JS:
 *
 *   - Preallocated slots (no allocation on the hot path).
 *   - Head (read) and tail (write) cursors.
 *   - `overwrite=false` drops writes when full; `overwrite=true` overwrites
 *     the oldest slot.
 *   - Documented contract: one producer, one consumer.
 * =============================================================================
 */

export interface RingBufferOptions {
  capacity?: number;
  overwrite?: boolean;
}

export interface RingBufferStats {
  capacity: number;
  depth: number;
  pushed: number;
  popped: number;
  dropped: number;
  overwritten: number;
}

export class RingBuffer<T> {
  private slots: Array<T | undefined>;
  private capacity: number;
  private overwrite: boolean;
  private head = 0; // read cursor
  private tail = 0; // write cursor
  private count = 0;
  private pushed = 0;
  private popped = 0;
  private dropped = 0;
  private overwritten = 0;

  constructor(options: RingBufferOptions = {}) {
    this.capacity = Math.max(2, options.capacity ?? 1024);
    this.overwrite = options.overwrite ?? false;
    this.slots = new Array<T | undefined>(this.capacity);
  }

  /** Push an item. Returns false when the buffer is full and overwrite=false. */
  public push(item: T): boolean {
    if (this.count === this.capacity) {
      if (!this.overwrite) {
        this.dropped++;
        return false;
      }
      // Overwrite the oldest slot: advance head.
      this.slots[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.count--;
      this.overwritten++;
    }

    this.slots[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    this.pushed++;
    return true;
  }

  /** Pop the oldest item. Returns undefined when empty. */
  public pop(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.slots[this.head];
    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    this.popped++;
    return item;
  }

  public peek(): T | undefined {
    if (this.count === 0) return undefined;
    return this.slots[this.head];
  }

  public get depth(): number {
    return this.count;
  }

  public isEmpty(): boolean {
    return this.count === 0;
  }

  public isFull(): boolean {
    return this.count === this.capacity;
  }

  /** Drain all items in FIFO order (destructive). */
  public drain(): T[] {
    const items: T[] = [];
    while (this.count > 0) {
      const item = this.pop();
      if (item !== undefined) items.push(item);
    }
    return items;
  }

  /** Snapshot all items in FIFO order without consuming them. */
  public toArray(): T[] {
    const items: T[] = [];
    let idx = this.head;
    for (let i = 0; i < this.count; i++) {
      const item = this.slots[idx];
      if (item !== undefined) items.push(item);
      idx = (idx + 1) % this.capacity;
    }
    return items;
  }

  public clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  public getStats(): RingBufferStats {
    return {
      capacity: this.capacity,
      depth: this.count,
      pushed: this.pushed,
      popped: this.popped,
      dropped: this.dropped,
      overwritten: this.overwritten,
    };
  }
}

export default RingBuffer;
