const fs = require('fs');
const path = require('path');
const fsPromises = fs.promises;
const ROLES_FILE = path.join(__dirname, '..', '..', 'runtime', 'rbac', 'roles.json');
const USERS_FILE = path.join(__dirname, '..', '..', 'runtime', 'rbac', 'users.json');
// In-memory cache with TTL (5 minutes)
let roleCache = null;
let userCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_ROLES = {
    admin: ['*'],
    developer: ['agent:run', 'plugin:install', 'logs:read'],
    viewer: ['status:read', 'logs:read'],
    agent: ['agent:run']
};
async function initRBAC() {
    try {
        const dir = path.dirname(ROLES_FILE);
        await fsPromises.mkdir(dir, { recursive: true });
        if (!fs.existsSync(ROLES_FILE)) {
            await fsPromises.writeFile(ROLES_FILE, JSON.stringify(DEFAULT_ROLES, null, 2), 'utf8');
        }
        if (!fs.existsSync(USERS_FILE)) {
            await fsPromises.writeFile(USERS_FILE, JSON.stringify({ admin: { role: 'admin' } }, null, 2), 'utf8');
        }
    }
    catch (err) {
        console.error('[RBAC] Init error:', err);
        throw err;
    }
}
async function invalidateCache() {
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
    }
    catch (err) {
        console.error('[RBAC] Cache error:', err);
        throw err;
    }
}
async function getUserRole(username) {
    await ensureCached();
    return userCache[username]?.role || null;
}
async function hasPermission(username, action) {
    const role = await getUserRole(username);
    if (!role)
        return false;
    await ensureCached();
    const permissions = roleCache[role] || [];
    return permissions.includes('*') || permissions.includes(action);
}
async function addUser(username, role) {
    await initRBAC();
    await ensureCached();
    userCache[username] = { role, createdAt: new Date().toISOString() };
    await fsPromises.writeFile(USERS_FILE, JSON.stringify(userCache, null, 2), 'utf8');
    await invalidateCache();
}
async function addRole(name, permissions) {
    await initRBAC();
    await ensureCached();
    roleCache[name] = permissions;
    await fsPromises.writeFile(ROLES_FILE, JSON.stringify(roleCache, null, 2), 'utf8');
    await invalidateCache();
}
// CLI support (synchronous fallback for setup scripts)
if (require.main === module) {
    const cmd = process.argv[2];
    if (cmd === 'check') {
        (async () => {
            await initRBAC();
            const granted = await hasPermission(process.argv[3], process.argv[4]);
            console.log(granted ? 'granted' : 'denied');
        })();
    }
    else if (cmd === 'add-user') {
        (async () => {
            await addUser(process.argv[3], process.argv[4] || 'developer');
            console.log('User added');
        })();
    }
    else if (cmd === 'add-role') {
        (async () => {
            await addRole(process.argv[3], process.argv.slice(4));
            console.log('Role added');
        })();
    }
    else {
        console.log('Usage: node rbac.js [check|add-user|add-role] ...');
    }
}
module.exports = { initRBAC, hasPermission, addUser, addRole, invalidateCache };
export {};
