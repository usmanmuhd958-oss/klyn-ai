import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fsPromises = fs.promises;

const ROLES_FILE = process.env.KLYN_RBAC_DIR
  ? path.join(process.env.KLYN_RBAC_DIR, 'roles.json')
  : path.join(import.meta.dirname, '..', '..', 'runtime', 'rbac', 'roles.json');
const USERS_FILE = process.env.KLYN_RBAC_DIR
  ? path.join(process.env.KLYN_RBAC_DIR, 'users.json')
  : path.join(import.meta.dirname, '..', '..', 'runtime', 'rbac', 'users.json');

// In-memory cache with TTL (5 minutes)
let roleCache: Record<string, string[]> | null = null;
let userCache: Record<string, any> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

const DEFAULT_ROLES = {
  admin: ['*'],
  developer: ['agent:run', 'plugin:install', 'logs:read'],
  viewer: ['status:read', 'logs:read'],
  agent: ['agent:run']
};

export async function initRBAC() {
  try {
    const dir = path.dirname(ROLES_FILE);
    await fsPromises.mkdir(dir, { recursive: true });
    
    if (!fs.existsSync(ROLES_FILE)) {
      await fsPromises.writeFile(ROLES_FILE, JSON.stringify(DEFAULT_ROLES, null, 2), 'utf8');
    }
    if (!fs.existsSync(USERS_FILE)) {
      await fsPromises.writeFile(USERS_FILE, JSON.stringify({ admin: { role: 'admin' } }, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[RBAC] Init error:', err);
    throw err;
  }
}

export async function invalidateCache() {
  cacheTimestamp = 0;
}

async function ensureCached() {
  const now = Date.now();
  if (roleCache && userCache && (now - cacheTimestamp) < CACHE_TTL) {
    return;
  }
  try {
    const [rolesData, usersData] = await Promise.all([
      fsPromises.readFile(ROLES_FILE, 'utf8').catch(() => '{}'),
      fsPromises.readFile(USERS_FILE, 'utf8').catch(() => '{}')
    ]);
    roleCache = JSON.parse(rolesData);
    userCache = JSON.parse(usersData);
    cacheTimestamp = now;
  } catch (err) {
    console.error('[RBAC] Cache error:', err);
    throw err;
  }
}

async function getUserRole(username: string) {
  await ensureCached();
  return userCache?.[username]?.role || null;
}

export async function hasPermission(username: string, action: string) {
  const role = await getUserRole(username);
  if (!role) return false;
  await ensureCached();
  const permissions = roleCache?.[role] || [];
  return permissions.includes('*') || permissions.includes(action);
}

export async function addUser(username: string, role: string) {
  await initRBAC();
  await ensureCached();
  if (!userCache) userCache = {};
  userCache[username] = { role, createdAt: new Date().toISOString() };
  await fsPromises.writeFile(USERS_FILE, JSON.stringify(userCache, null, 2), 'utf8');
  await invalidateCache();
}

export async function addRole(name: string, permissions: string[]) {
  await initRBAC();
  await ensureCached();
  if (!roleCache) roleCache = {};
  roleCache[name] = permissions;
  await fsPromises.writeFile(ROLES_FILE, JSON.stringify(roleCache, null, 2), 'utf8');
  await invalidateCache();
}

// CLI support (ESM main check)
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
    console.log('Usage: node rbac.js [check|add-user|add-role] ...');
  }
}

export { initRBAC as __rbacInit, hasPermission as __rbacHasPermission, addUser as __rbacAddUser };
