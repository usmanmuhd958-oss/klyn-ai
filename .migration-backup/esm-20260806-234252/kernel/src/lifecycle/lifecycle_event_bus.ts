'use strict';

type EventHandler = (data: any, correlId?: string) => void;

class KlynLifecycleEventBus {
  private _handlers = new Map<string, EventHandler[]>();

  on(event: string, handler: EventHandler): void {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler): void {
    const list = this._handlers.get(event);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  emit(event: string, data: any, correlId?: string): void {
    const handlers = this._handlers.get(event) || [];
    for (const handler of [...handlers]) {
      handler(data, correlId);
    }
  }
}

let instance: KlynLifecycleEventBus | null = null;

export function getEventBus(): KlynLifecycleEventBus {
  if (!instance) instance = new KlynLifecycleEventBus();
  return instance;
}

export function _resetBusForTesting(): void {
  instance = null;
}

/**
 * Lifecycle/event name constants. Previously an empty object, which made every
 * consumer that indexed into it (e.g. LIFECYCLE_EVENT.KERNEL_SHUTDOWN_START)
 * emit/read `undefined` event names at runtime.
 */
export const LIFECYCLE_EVENT = Object.freeze({
  KERNEL_SHUTDOWN_START:   'kernel:shutdown:start',
  KERNEL_SHUTDOWN_COMPLETE: 'kernel:shutdown:complete',
  AGENT_HOT_SWAPPED:       'agent:hot_swapped',
  AGENT_HOT_SWAP_FAILED:   'agent:hot_swap_failed',
  AGENT_ROLLBACK:          'agent:rollback',
  AGENT_RESTART_REQUESTED: 'agent:restart_requested',
  AGENT_RECOVERED:         'agent:recovered',
  AGENT_DEGRADED:          'agent:degraded',
  AGENT_FAULTED:           'agent:faulted',
  KERNEL_READY:            'kernel:ready',
  IPC_MESSAGE_REJECTED:    'ipc:message_rejected',
  TASK_COMPLETED:          'task:completed',
  TASK_FAILED:             'task:failed',
});

export { KlynLifecycleEventBus };
