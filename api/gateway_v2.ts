'use strict';

// =============================================================================
// KLYN AI OS — Hardened Multi-Tenant API Gateway & Auth (Phase 14)
// File: api/gateway_v2.ts
//
// Phase 14 capability #3. Upgrades the Phase 9 static-token surface into a
// SIGNED-JWT gateway: Ed25519-signed compact JWTs (per-tenant key isolation —
// each tenant owns its own signing keypair, so no tenant can forge another's
// tokens), Role-Based Access Control over every route, and an external audit
// export so third-party auditors can verify the post-quantum Merkle chain
// without any secret:
//
//   const gw = new GatewayV2({ adminSeed: 'prod-seed' });   // admin tenant
//   const adminToken = gw.issueAdminToken();                // bootstrap JWT
//   const tenant = gw.createTenant('acme', 'operator');
//   const token = gw.issueToken('acme');                    // EdDSA-signed JWT
//   const claims = gw.verifyToken(token);                   // { sub, role, ... }
//   gw.hasPermission(claims, 'audit:read');                 // RBAC
//
//   const { handler, adminToken } = bootstrapGateway({ gateway: gw });
//   const res = await handler({ method: 'GET', url: '/v1/audit/export',
//     headers: { authorization: `Bearer ${adminToken}` } });
//
// AUTH MODEL:
//   - Every request needs a valid signed JWT (no static tokens on this
//     surface). The admin tenant is seeded deterministically from
//     KLYN_GATEWAY_ADMIN_SEED (or a default) so production can mint
//     operator/auditor/viewer tokens for tenants from a single trusted key.
//   - Roles are read from the VERIFIED TENANT RECORD, never from the token
//     claims alone (defense in depth: a tenant cannot self-escalate — the
//     signature is bound to their key and the role claim must match).
//   - RBAC: admin='*'; operator = system read/write + audit + mesh + heal;
//     auditor = audit:read only; viewer = system:read only. Non-gateway
//     routes need system:read (GET) / system:write (POST).
//
// SURFACE: gateway routes (token issuance, tenants, prometheus, traces,
// artifact plan) are handled here; audit export + every earlier phase route
// delegate to the shared Phase 9 core with an internal token — one handler
// implementation, two auth layers.
// =============================================================================
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import crypto from 'node:crypto';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { ArtifactEngine } from '../packages/deploy/src/artifact.js';
import { PrometheusRegistry, OtelTracer } from '../packages/deploy/src/observability.js';
import { createPhase9Handler, type Phase9Deps, type HeadlessRequest, type HeadlessResponse } from './router.js';

const express = require('express');

// -----------------------------------------------------------------------------
// JWT PRIMITIVES (EdDSA / Ed25519 — compact JWS)
// -----------------------------------------------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: KeyObject): string {
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const sig = crypto.sign(null, Buffer.from(input, 'utf8'), privateKey).toString('base64url');
  return `${input}.${sig}`;
}

function verifyJwt(token: string, publicKey: KeyObject): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'EdDSA' || header.typ !== 'JWT') return null;
  const valid = crypto.verify(null, Buffer.from(`${h}.${p}`, 'utf8'), publicKey, Buffer.from(s, 'base64url'));
  return valid ? payload : null;
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function deriveKeyPair(seed: string): { privateKey: KeyObject; publicKey: KeyObject; publicKeyB64: string } {
  const seedBuf = createHash('sha256').update(`klyn-gateway:${seed}`).digest().subarray(0, 32);
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seedBuf]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

function randomKeyPair(): { privateKey: KeyObject; publicKey: KeyObject; publicKeyB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey, publicKeyB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

// -----------------------------------------------------------------------------
// RBAC MODEL
// -----------------------------------------------------------------------------

export type Role = 'admin' | 'operator' | 'auditor' | 'viewer';

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  admin: ['*'],
  operator: ['system:read', 'system:write', 'audit:read', 'mesh:write', 'heal:execute'],
  auditor: ['audit:read'],
  viewer: ['system:read'],
};

/** Permission required by each gateway-native route. Non-gateway routes fall
 *  back to system:read (GET) / system:write (POST). */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  'POST /v1/gateway/token': 'system:admin',
  'GET /v1/gateway/tenants': 'system:admin',
  'GET /v1/audit/export': 'audit:read',
  'GET /v1/metrics/prometheus': 'system:read',
  'GET /v1/traces': 'system:read',
  'GET /v1/artifacts/plan': 'system:read',
};

export const PHASE14_GATEWAY_ROUTES = Object.keys(ROUTE_PERMISSIONS);

// -----------------------------------------------------------------------------
// GATEWAY V2 — tenants, token issuance, verification, RBAC
// -----------------------------------------------------------------------------

export interface TenantRecord {
  tenantId: string;
  role: Role;
  publicKeyB64: string;
  issuedAt: number;
}

export interface TokenClaims {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
}

export interface GatewayV2Options {
  /** Seed for the bootstrap ADMIN tenant's keypair (deterministic across
   *  restarts). Production sets KLYN_GATEWAY_ADMIN_SEED. */
  adminSeed?: string;
  adminTenantId?: string;
  tokenTtlMs?: number;
  now?: () => number;
}

export class GatewayV2 {
  private readonly tenants = new Map<string, { record: TenantRecord; privateKey: KeyObject }>();
  private readonly adminTenantId: string;
  private readonly tokenTtlMs: number;
  private readonly nowFn: () => number;
  private jtiCounter = 0;

  constructor(options: GatewayV2Options = {}) {
    this.adminTenantId = options.adminTenantId ?? 'klyn-admin';
    this.tokenTtlMs = options.tokenTtlMs ?? 3_600_000;
    this.nowFn = options.now ?? (() => Date.now());
    this.createTenant(this.adminTenantId, 'admin', options.adminSeed ?? process.env.KLYN_GATEWAY_ADMIN_SEED ?? 'klyn-gateway-admin-v1');
  }

  /** Register a tenant with an isolated Ed25519 signing keypair. When `seed`
   *  is given the keypair is deterministic (admin bootstrap); otherwise it is
   *  freshly generated. */
  createTenant(tenantId: string, role: Role, seed?: string): TenantRecord {
    if (this.tenants.has(tenantId)) throw new Error(`GatewayV2: tenant ${tenantId} already exists`);
    const key = seed ? deriveKeyPair(seed) : randomKeyPair();
    const record: TenantRecord = { tenantId, role, publicKeyB64: key.publicKeyB64, issuedAt: this.nowFn() };
    this.tenants.set(tenantId, { record, privateKey: key.privateKey });
    return { ...record };
  }

  removeTenant(tenantId: string): boolean {
    if (tenantId === this.adminTenantId) return false; // admin is never removed
    return this.tenants.delete(tenantId);
  }

  listTenants(): TenantRecord[] {
    return Array.from(this.tenants.values())
      .map((t) => ({ ...t.record }))
      .sort((a, b) => (a.tenantId < b.tenantId ? -1 : 1));
  }

  tenant(tenantId: string): TenantRecord | null {
    const t = this.tenants.get(tenantId);
    return t ? { ...t.record } : null;
  }

  /** Mint a signed JWT for a tenant (role is bound to the tenant record). */
  issueToken(tenantId: string, ttlMs?: number): string {
    const entry = this.tenants.get(tenantId);
    if (!entry) throw new Error(`GatewayV2: unknown tenant ${tenantId}`);
    const now = this.nowFn();
    const payload: TokenClaims = {
      sub: tenantId,
      role: entry.record.role,
      iat: now,
      exp: now + (ttlMs ?? this.tokenTtlMs),
      jti: `${tenantId}:${++this.jtiCounter}:${now.toString(36)}`,
      iss: 'klyn-gateway-v2',
    };
    return signJwt({ alg: 'EdDSA', typ: 'JWT' }, payload as unknown as Record<string, unknown>, entry.privateKey);
  }

  /** Bootstrap capability for the operator: a JWT for the admin tenant. */
  issueAdminToken(): string {
    return this.issueToken(this.adminTenantId);
  }

  /** Verify a token: signature against the issuing tenant's key, expiry,
   *  issuer, and role-claim consistency. Role comes from the RECORD. */
  verifyToken(token: string): TokenClaims | null {
    if (typeof token !== 'string' || token.length === 0) return null;
    for (const [tenantId, entry] of this.tenants) {
      const payload = verifyJwt(token, crypto.createPublicKey(entry.privateKey));
      if (!payload) continue;
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub !== tenantId) continue;
      if (payload.iss !== 'klyn-gateway-v2') continue;
      const iat = typeof payload.iat === 'number' ? payload.iat : 0;
      const exp = typeof payload.exp === 'number' ? payload.exp : 0;
      if (this.nowFn() >= exp) return null; // expired
      const claimRole = payload.role as Role;
      if (claimRole !== entry.record.role) return null; // self-escalation attempt
      return {
        sub: tenantId,
        role: entry.record.role,
        iat,
        exp,
        jti: typeof payload.jti === 'string' ? payload.jti : '',
        iss: 'klyn-gateway-v2',
      };
    }
    return null;
  }

  hasPermission(claims: TokenClaims, permission: string): boolean {
    const role = claims.role;
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) return false;
    return perms.includes('*') || perms.includes(permission);
  }
}

// -----------------------------------------------------------------------------
// HEADLESS GATEWAY HANDLER
// -----------------------------------------------------------------------------

export interface GatewayV2Deps extends Phase9Deps {
  gateway?: GatewayV2;
  /** Bootstrap admin JWT (defaults to gateway.issueAdminToken()). */
  adminToken?: string;
  metrics?: PrometheusRegistry;
  tracer?: OtelTracer;
}

const ok = (data: unknown, status = 200): HeadlessResponse => ({
  status,
  body: { success: true, data, timestamp: new Date().toISOString() },
});

const fail = (code: string, message: string, status: number, details: unknown = null): HeadlessResponse => ({
  status,
  body: { success: false, error: { code, message, details }, timestamp: new Date().toISOString() },
});

function parseRoute(url: string): { path: string; query: URLSearchParams } {
  const qIdx = url.indexOf('?');
  const path = qIdx === -1 ? url : url.slice(0, qIdx);
  const query = new URLSearchParams(qIdx === -1 ? '' : url.slice(qIdx + 1));
  return { path, query };
}

function bearerToken(headers: Record<string, unknown>): string | null {
  const raw = headers['authorization'] ?? headers['Authorization'];
  const header = Array.isArray(raw) ? raw[0] : String(raw ?? '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export interface GatewayBootstrap {
  handler: (req: HeadlessRequest) => Promise<HeadlessResponse>;
  gateway: GatewayV2;
  adminToken: string;
}

export function bootstrapGateway(deps: GatewayV2Deps = {}): GatewayBootstrap {
  const gateway = deps.gateway ?? new GatewayV2({});
  const adminToken = deps.adminToken ?? gateway.issueAdminToken();
  const metrics = deps.metrics ?? new PrometheusRegistry();
  const tracer = deps.tracer ?? new OtelTracer({ serviceName: 'klyn-ai-os' });
  const repoRoot = deps.repoRoot ?? process.cwd();
  const internalToken = `klyn-internal:${crypto.randomBytes(16).toString('hex')}`;
  const phase9 = createPhase9Handler({ ...deps, token: internalToken });

  const handler = async (req: HeadlessRequest): Promise<HeadlessResponse> => {
    const { path, query } = parseRoute(req.url);
    const method = (req.method || 'GET').toUpperCase();
    const routeKey = `${method} ${path}`;

    // Public health — minimal, no process state.
    if (method === 'GET' && (path === '/v1/health' || path === '/health')) {
      return ok({ status: 'ok', service: 'klyn-ai-os', gateway: 'v2' });
    }

    // Every other route requires a valid signed JWT.
    const rawToken = bearerToken(req.headers);
    const claims = rawToken ? gateway.verifyToken(rawToken) : null;
    if (!claims) return fail('UNAUTHORIZED', 'Valid signed JWT required', 401);

    // RBAC: gateway routes have explicit permissions; delegated routes fall
    // back to system:read (GET) / system:write (POST).
    const required = ROUTE_PERMISSIONS[routeKey] ?? (method === 'POST' ? 'system:write' : 'system:read');
    if (!gateway.hasPermission(claims, required)) {
      return fail('FORBIDDEN', `role '${claims.role}' lacks permission '${required}' for ${routeKey}`, 403);
    }

    // ── POST /v1/gateway/token — mint a tenant token (admin only) ───────────
    if (routeKey === 'POST /v1/gateway/token') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = String(payload.tenantId ?? '');
      const role = String(payload.role ?? '') as Role;
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(tenantId)) return fail('VALIDATION_ERROR', 'tenantId required (alphanumeric, up to 64 chars)', 422);
      if (!['admin', 'operator', 'auditor', 'viewer'].includes(role)) return fail('VALIDATION_ERROR', 'role must be admin|operator|auditor|viewer', 422);
      let tenant = gateway.tenant(tenantId);
      if (!tenant) tenant = gateway.createTenant(tenantId, role);
      const token = gateway.issueToken(tenantId);
      return ok({ token, tenant: { tenantId: tenant.tenantId, role: tenant.role, publicKeyB64: tenant.publicKeyB64 } });
    }

    // ── GET /v1/gateway/tenants — tenant registry (admin only) ──────────────
    if (routeKey === 'GET /v1/gateway/tenants') {
      return ok({ tenants: gateway.listTenants() });
    }

    // ── GET /v1/metrics/prometheus — live Prometheus text exposition ────────
    if (routeKey === 'GET /v1/metrics/prometheus') {
      return ok({ format: 'prometheus-text-0.0.4', metrics: metrics.render() });
    }

    // ── GET /v1/traces — recent OTel-shaped spans ───────────────────────────
    if (routeKey === 'GET /v1/traces') {
      return ok({ service: tracer.getServiceName(), spans: tracer.export(), total: tracer.totalSpans });
    }

    // ── GET /v1/artifacts/plan — deployable artifact plan + verification ────
    if (routeKey === 'GET /v1/artifacts/plan') {
      const plan = await ArtifactEngine.buildPlan(repoRoot);
      return ok(plan);
    }

    // ── Delegate everything else to the shared Phase 9 core (audit export,
    //    temporal, mesh, federation, heals...) with the internal token. ──────
    const headers: Record<string, unknown> = { ...req.headers, authorization: `Bearer ${internalToken}` };
    return phase9({ ...req, headers, url: req.url });
  };

  return { handler, gateway, adminToken };
}

/** Convenience: just the callable handler (klyn_server.js, tests). */
export function createGatewayV2Handler(deps: GatewayV2Deps = {}): (req: HeadlessRequest) => Promise<HeadlessResponse> {
  return bootstrapGateway(deps).handler;
}

// -----------------------------------------------------------------------------
// EXPRESS ROUTER (Phase 14 surface)
// -----------------------------------------------------------------------------

export function createGatewayV2Router(deps: GatewayV2Deps = {}): any {
  const router = express.Router();
  const { handler } = bootstrapGateway(deps);
  for (const routeKey of PHASE14_GATEWAY_ROUTES) {
    const [method, path] = routeKey.split(' ');
    const fn = method.toLowerCase();
    router[fn](path, async (req: any, res: any) => {
      const result = await handler({ method, url: req.originalUrl ?? req.url, headers: req.headers, body: req.body });
      res.status(result.status).json(result.body);
    });
  }
  return router;
}

export default GatewayV2;
