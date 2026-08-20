/**
 * @fileoverview Klyn AI OS - Typed Event Emitter
 * @module core/typed-event-emitter
 * @author Klyn Systems Architecture Team
 * @license Proprietary
 *
 * Generic event emitter with typed event payloads and listener accounting.
 */

import { EventEmitter } from 'events';

export class TypedEventEmitter<TEventMap extends Record<string, unknown>> {
  private readonly emitter: EventEmitter;

  constructor(maxListeners = 1000) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(maxListeners);
  }

  on<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.on(event as string, handler);
    return this;
  }

  once<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.once(event as string, handler);
    return this;
  }

  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): boolean {
    return this.emitter.emit(event as string, payload);
  }

  off<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.off(event as string, handler);
    return this;
  }

  removeAllListeners(event?: keyof TEventMap): this {
    this.emitter.removeAllListeners(event as string);
    return this;
  }

  listenerCount(event: keyof TEventMap): number {
    return this.emitter.listenerCount(event as string);
  }
}
