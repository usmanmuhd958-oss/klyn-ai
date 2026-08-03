/**
 * =============================================================================
 * KLYN AI OS — jose.js
 * File: kernel/src/auth/jose.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Self-contained JWT (HS256) implementation plus RBAC helpers for the
 *   secure API. Replaces the previously missing `jsonwebtoken` dependency
 *   and the nonexistent `kernel/src/auth/rbac.js` with a single ESM module
 *   that runs under "type": "module" with zero external dependencies.
 *
 * API:
 *   sign(payload, secret, { expiresIn }) -> token string
 *   verify(token, secret)                -> payload (throws on invalid)
 *   initRBAC() / hasPermission() / addUser() / addRole()
 * =============================================================================
 */

'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// -----------------------------------------------------------------------------
// HS256 JWT
// -----------------------------------------------------------------------------

const base64url = (input) => Buffer.from(input).toString('base64url');
const fromBase64url = (input) => Buffer.from(input, 'base64url');

/**
 * Signs a JWT with HMAC-SHA256.
 * @param {object} payload
 * @param {string} secret
 * @param {{ expiresIn?: string|number }} [options]  e.g. '24h' or 3600
 * @returns {string}
 */
export function sign(payload, secret, options = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now };

  if (options.expiresIn) {
    body.exp = now + parseExpiresIn(options.expiresIn);
  }

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedBody}.${signature}`;
}

/**
 * Verifies a JWT signature and expiry. Throws on any failure.
 * @param {string} token
 * @param {string} secret
 * @returns {object}  Decoded payload.
 */
export function verify(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Invalid token structure');

  const [encodedHeader, encodedBody, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid signature');
  }

  const payload = JSON.parse(fromBase64url(encodedBody).toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return payload;
}

function parseExpiresIn(value) {
  if (typeof value === 'number') return value;
  const match = /^(\d+)([smhd])$/.exec(String(value));
  if (!match) throw new Error(`Invalid expiresIn value: ${value}`);
  const n = parseInt(match[1], 10);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  return n * unit;
}

// -----------------------------------------------------------------------------
// RBAC (file-backed roles/users)
// -----------------------------------------------------------------------------

const RBAC_DIR = process.env.KLYN_RBAC_DIR || path.join(import.meta.dirname, '..', '..', 'runtime', 'rbac');
const ROLES_FILE = path.join(RBAC_DIR, 'roles.json');
const USERS_FILE = path.join(RBAC_DIR, 'users.json');

const DEFAULT_ROLES = {
  admin: ['*'],
  developer: ['agent:run', 'plugin:install', 'logs:read'],
  viewer: ['status:read', 'logs:read'],
  agent: ['agent:run'],
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let roleCache = null;
let userCache = null;
let cacheTimestamp = 0;

export async function initRBAC() {
  await fs.promises.mkdir(RBAC_DIR, { recursive: true });
  if (!fs.existsSync(ROLES_FILE)) {
    await fs.promises.writeFile(ROLES_FILE, JSON.stringify(DEFAULT_ROLES, null, 2), 'utf8');
  }
  if (!fs.existsSync(USERS_FILE)) {
    await fs.promises.writeFile(USERS_FILE, JSON.stringify({ admin: { role: 'admin' } }, null, 2), 'utf8');
  }
}

export async function invalidateCache() {
  cacheTimestamp = 0;
}

async function ensureCached() {
  const now = Date.now();
  if (roleCache && userCache && now - cacheTimestamp < CACHE_TTL) return;
  const [rolesData, usersData] = await Promise.all([
    fs.promises.readFile(ROLES_FILE, 'utf8').catch(() => '{}'),
    fs.promises.readFile(USERS_FILE, 'utf8').catch(() => '{}'),
  ]);
  roleCache = JSON.parse(rolesData);
  userCache = JSON.parse(usersData);
  cacheTimestamp = now;
}

async function getUserRole(username) {
  await ensureCached();
  return userCache?.[username]?.role || null;
}

export async function hasPermission(username, action) {
  const role = await getUserRole(username);
  if (!role) return false;
  await ensureCached();
  const permissions = roleCache?.[role] || [];
  return permissions.includes('*') || permissions.includes(action);
}

export async function addUser(username, role) {
  await initRBAC();
  await ensureCached();
  userCache[username] = { role, createdAt: new Date().toISOString() };
  await fs.promises.writeFile(USERS_FILE, JSON.stringify(userCache, null, 2), 'utf8');
  await invalidateCache();
}

export async function addRole(name, permissions) {
  await initRBAC();
  await ensureCached();
  roleCache[name] = permissions;
  await fs.promises.writeFile(ROLES_FILE, JSON.stringify(roleCache, null, 2), 'utf8');
  await invalidateCache();
}

// CLI support (ESM main check): node jose.js check <user> <action>
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === 'check') {
    (async () => {
      await initRBAC();
      const granted = await hasPermission(process.argv[3], process.argv[4]);
      console.log(granted ? 'granted' : 'denied');
    })();
  } else if (cmd === 'add-user') {
    (async () => {
      await addUser(process.argv[3], process.argv[4] || 'developer');
      console.log('User added');
    })();
  } else if (cmd === 'add-role') {
    (async () => {
      await addRole(process.argv[3], process.argv.slice(4));
      console.log('Role added');
    })();
  } else {
    console.log('Usage: node jose.js [check|add-user|add-role] ...');
  }
}
