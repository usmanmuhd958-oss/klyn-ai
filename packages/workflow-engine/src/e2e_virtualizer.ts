// =============================================================================
// KLYN AI OS — workflow-engine — Spec-Driven E2E Virtualization
// File: packages/workflow-engine/src/e2e_virtualizer.ts
//
// Phase 5 capability #4. Generates ZERO-OVERHEAD in-memory HTTP + WebSocket
// mock servers directly from Phase 4 spec_compiler outputs:
//
//   const v = E2EVirtualizer.fromIntent(intent);   // compiles the spec
//   await v.request('POST', '/projects', body);    // real dispatch, no ports
//   const ws = v.openWs('/projects/live');         // virtual websocket
//   ws.send(...);                                  // in-process broadcast
//
// No live database connections, no port bindings, no sockets — the whole E2E
// surface runs in-process, so full workflow integration tests (create → list
// → read → update → delete, plus realtime fan-out) execute against the exact
// routes, methods, and schemas the Phase 4 synthesizer declared.
//
// The virtualizer is deterministic: row ids come from the body when the
// schema declares an `id` field, otherwise from a pluggable generator.
// =============================================================================
import { randomUUID } from 'node:crypto';
import {
  compileIntent,
  type ArchitectureIntent,
  type CompiledEndpoint,
  type CompiledSpec,
} from '../../../1.brain/spec_compiler.js';

export interface VirtualRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  ctx?: Record<string, unknown>;
}

export interface VirtualResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface VirtualSocket {
  readonly path: string;
  /** Send a message to every OTHER client connected to the same path. */
  send(message: unknown): void;
  onMessage(handler: (message: unknown, from: string) => void): void;
  close(): void;
}

export interface VirtualizerStats {
  requests: number;
  requestsByRoute: Record<string, number>;
  wsConnections: number;
  wsMessages: number;
  rows: number;
  avgLatencyMs: number;
}

type HandlerResponse = { status: number; body: unknown };
type RouteHandler = (body: unknown, ctx: Record<string, unknown>, params: Record<string, string>) => Promise<HandlerResponse>;

const VALID_TYPES = new Set(['id', 'string', 'number', 'boolean', 'date', 'json']);

export class E2EVirtualizer {
  readonly spec: CompiledSpec;
  private routes = new Map<string, { pattern: RegExp; keys: string[]; handler: RouteHandler }>();
  private store = new Map<string, Record<string, unknown>>();
  private sockets = new Map<string, Set<{ id: string; send: (m: unknown, from: string) => void }>>();
  private requestCount = 0;
  private requestsByRouteCount = new Map<string, number>();
  private wsConnections = 0;
  private wsMessages = 0;
  private totalLatencyMs = 0;

  private constructor(
    intent: ArchitectureIntent,
    private idProvider: () => string = () => randomUUID()
  ) {
    this.spec = compileIntent(intent);
    for (const endpoint of this.spec.endpoints) {
      this.registerRoute(endpoint);
    }
  }

  /** Build a virtualizer straight from a Phase 4 architectural intent. */
  static fromIntent(intent: ArchitectureIntent, idProvider?: () => string): E2EVirtualizer {
    return new E2EVirtualizer(intent, idProvider);
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  /** Dispatch one request through the in-memory route table. */
  async request(req: VirtualRequest): Promise<VirtualResponse> {
    const t0 = performance.now();
    const matched = this.match(req.method, req.path);
    if (!matched) {
      const resp: VirtualResponse = { status: 404, body: { ok: false, errors: [`no virtual route for ${req.method} ${req.path}`] }, latencyMs: performance.now() - t0 };
      this.track(req, resp, t0);
      return resp;
    }
    try {
      const handled = await matched.handler(req.body, req.ctx ?? {}, matched.params);
      const resp: VirtualResponse = { ...handled, latencyMs: performance.now() - t0 };
      this.track(req, resp, t0);
      return resp;
    } catch (error) {
      const resp: VirtualResponse = { status: 500, body: { ok: false, errors: [error instanceof Error ? error.message : String(error)] }, latencyMs: performance.now() - t0 };
      this.track(req, resp, t0);
      return resp;
    }
  }

  // -------------------------------------------------------------------------
  // WEBSOCKET (virtual — in-process fan-out, no ports)
  // -------------------------------------------------------------------------

  /** Open a virtual websocket client on a path. Messages broadcast to every
   *  other client on the same path; the sender's own socket does not echo. */
  openWs(path: string): VirtualSocket {
    const id = this.idProvider();
    this.wsConnections++;
    let closed = false;
    const handlers = new Set<(message: unknown, from: string) => void>();

    const peers = this.sockets.get(path) ?? new Set();
    const self: { id: string; send: (m: unknown, from: string) => void } = {
      id,
      send: (message, from) => {
        if (closed) return;
        for (const handler of handlers) {
          try {
            handler(message, from);
          } catch {
            // listener errors never break the broadcast
          }
        }
      },
    };
    peers.add(self);
    this.sockets.set(path, peers);

    return {
      path,
      send: (message) => {
        if (closed) return;
        this.wsMessages++;
        for (const peer of peers) {
          if (peer.id !== id) peer.send(message, id);
        }
      },
      onMessage: (handler) => {
        handlers.add(handler);
      },
      close: () => {
        if (closed) return;
        closed = true;
        peers.delete(self);
        if (peers.size === 0) this.sockets.delete(path);
      },
    };
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  getStats(): VirtualizerStats {
    const requestsByRoute: Record<string, number> = {};
    for (const [key, count] of this.requestsByRouteCount) {
      requestsByRoute[key] = count;
    }
    return {
      requests: this.requestCount,
      requestsByRoute,
      wsConnections: this.wsConnections,
      wsMessages: this.wsMessages,
      rows: this.store.size,
      avgLatencyMs: this.requestCount === 0 ? 0 : this.totalLatencyMs / this.requestCount,
    };
  }

  rowCount(): number {
    return this.store.size;
  }

  dumpRows(): Array<Record<string, unknown>> {
    return Array.from(this.store.values()).map((r) => ({ ...r }));
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private registerRoute(endpoint: CompiledEndpoint): void {
    const keys: string[] = [];
    const patternSource = endpoint.path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const pattern = new RegExp(`^${patternSource}$`);
    this.routes.set(`${endpoint.method} ${endpoint.path}`, { pattern, keys, handler: this.handlerFor(endpoint) });
  }

  private handlerFor(endpoint: CompiledEndpoint): RouteHandler {
    const table = this.spec.table;
    switch (endpoint.method) {
      case 'POST': {
        return async (body) => {
          const verdict = validateBody(this.spec, body);
          if (!verdict.ok) return { status: 400, body: { ok: false, errors: verdict.errors } };
          const id = String((body as Record<string, unknown>).id ?? this.idProvider());
          const row = { ...verdict.value, id };
          this.store.set(id, row);
          return { status: 201, body: { ok: true, value: row } };
        };
      }
      case 'GET': {
        if (endpoint.path.endsWith('/:id')) {
          return async (_body, _ctx, params) => {
            const row = this.store.get(params.id);
            if (!row) return { status: 404, body: { ok: false, errors: [`${table} ${params.id} not found`] } };
            return { status: 200, body: { ok: true, value: row } };
          };
        }
        return async (_body, ctx) => {
          const rows = Array.from(this.store.values());
          const limit = typeof ctx.limit === 'number' ? ctx.limit : rows.length;
          return { status: 200, body: { ok: true, rows: rows.slice(0, limit), count: rows.length } };
        };
      }
      case 'PUT': {
        return async (body, _ctx, params) => {
          const existing = this.store.get(params.id);
          if (!existing) return { status: 404, body: { ok: false, errors: [`${table} ${params.id} not found`] } };
          const verdict = validateBody(this.spec, body);
          if (!verdict.ok) return { status: 400, body: { ok: false, errors: verdict.errors } };
          const row = { ...existing, ...verdict.value, id: existing.id };
          this.store.set(params.id, row);
          return { status: 200, body: { ok: true, value: row } };
        };
      }
      case 'DELETE': {
        return async (_body, _ctx, params) => {
          if (!this.store.has(params.id)) return { status: 404, body: { ok: false, errors: [`${table} ${params.id} not found`] } };
          this.store.delete(params.id);
          return { status: 200, body: { ok: true, deleted: params.id } };
        };
      }
    }
  }

  private match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const [key, entry] of this.routes) {
      const routeMethod = key.slice(0, key.indexOf(' '));
      if (routeMethod !== method) continue; // methods are first-class — GET /x never hits POST /x
      if (!entry.pattern.test(path)) continue;
      const match = path.match(entry.pattern);
      if (!match) continue;
      const params: Record<string, string> = {};
      entry.keys.forEach((keyName, i) => {
        params[keyName] = match[i + 1];
      });
      return { handler: entry.handler, params };
    }
    return null;
  }

  private track(req: VirtualRequest, resp: VirtualResponse, t0: number): void {
    this.requestCount++;
    this.totalLatencyMs += performance.now() - t0;
    resp.latencyMs = performance.now() - t0;
    const key = `${req.method} ${req.path}`;
    this.requestsByRouteCount.set(key, (this.requestsByRouteCount.get(key) ?? 0) + 1);
  }
}

/**
 * Runtime validation mirroring the spec_compiler's generated-validator rules
 * (same field types, same error strings) so the virtualizer rejects exactly
 * what the compiled routes would reject.
 */
export function validateBody(spec: CompiledSpec, body: unknown): { ok: boolean; errors: string[]; value: Record<string, unknown> } {
  const errors: string[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body must be a JSON object'], value: {} };
  }
  const raw = body as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  // Fields are recovered deterministically from the compiled interface source
  // (the exact AST output the spec_compiler emitted).
  const parsed = parseFieldsFromInterface(spec.interfaceCode);
  for (const field of parsed) {
    const present = raw[field.name] !== undefined;
    // A declared default means the field may be omitted (the compiler emits
    // `// default: <value>` on the interface member).
    if (!field.optional && !present && field.type !== 'id' && field.default === undefined) {
      errors.push(`${field.name} is required`);
    }
    if (present && !typeMatches(field, raw[field.name])) {
      errors.push(`${field.name} must be a ${field.type === 'date' ? 'ISO date string' : field.type}`);
    }
    if (present) value[field.name] = raw[field.name];
    else if (field.default !== undefined) value[field.name] = field.default;
  }
  return errors.length > 0 ? { ok: false, errors, value: {} } : { ok: true, errors: [], value };
}

/** Deterministic parse of the compiled interface source back into fields,
 *  including any declared `// default: <value>` on the member. */
function parseFieldsFromInterface(interfaceCode: string): Array<{ name: string; type: string; optional: boolean; default?: unknown }> {
  const body = interfaceCode.slice(interfaceCode.indexOf('{'), interfaceCode.lastIndexOf('}'));
  const fields: Array<{ name: string; type: string; optional: boolean; default?: unknown }> = [];
  const re = /\s*([A-Za-z][A-Za-z0-9]*)(\?)?:\s*([^;\n]+);(\s*\/\/\s*default:\s*(.*))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const type = match[3].trim();
    const normalized = type.startsWith('Record') ? 'json' : type.toLowerCase();
    if (!VALID_TYPES.has(normalized)) continue;
    const defaultRaw = match[5]?.trim();
    let defaultVal: unknown;
    if (defaultRaw !== undefined && defaultRaw !== '') {
      try {
        defaultVal = JSON.parse(defaultRaw);
      } catch {
        defaultVal = defaultRaw; // unquoted fallback (e.g. bare identifier)
      }
    }
    fields.push({ name: match[1], type: normalized, optional: match[2] === '?', default: defaultVal });
  }
  return fields;
}

function typeMatches(field: { name: string; type: string }, value: unknown): boolean {
  switch (field.type) {
    case 'id':
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'json':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

export default E2EVirtualizer;
