const fs = require('fs');
const path = require('path');

const ROLES_FILE = path.join(__dirname, '..', '..', 'runtime', 'rbac', 'roles.json');
const USERS_FILE = path.join(__dirname, '..', '..', 'runtime', 'rbac', 'users.json');

// Default roles and permissions
const DEFAULT_ROLES = {
  admin: ['*'],                    // all permissions
  developer: ['agent:run', 'plugin:install', 'logs:read'],
  viewer: ['status:read', 'logs:read'],
  agent: ['agent:run']
};

function initRBAC() {
  const dir = path.dirname(ROLES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ROLES_FILE)) fs.writeFileSync(ROLES_FILE, JSON.stringify(DEFAULT_ROLES, null, 2));
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ admin: { role: 'admin' } }, null, 2));
}

function getUserRole(username) {
  if (!fs.existsSync(USERS_FILE)) return null;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  return users[username]?.role || null;
}

function hasPermission(username, action) {
  const role = getUserRole(username);
  if (!role) return false;
  if (!fs.existsSync(ROLES_FILE)) return false;
  const roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
  const permissions = roles[role] || [];
  return permissions.includes('*') || permissions.includes(action);
}

function addUser(username, role) {
  if (!fs.existsSync(USERS_FILE)) initRBAC();
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  users[username] = { role };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function addRole(name, permissions) {
  if (!fs.existsSync(ROLES_FILE)) initRBAC();
  const roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
  roles[name] = permissions;
  fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
}

// CLI
if (require.main === module) {
  initRBAC();
  const cmd = process.argv[2];
  if (cmd === 'check') {
    console.log(hasPermission(process.argv[3], process.argv[4]) ? 'granted' : 'denied');
  } else if (cmd === 'add-user') {
    addUser(process.argv[3], process.argv[4]);
    console.log('User added');
  } else if (cmd === 'add-role') {
    addRole(process.argv[3], process.argv.slice(4));
    console.log('Role added');
  } else {
    console.log('Usage: node rbac.js [check|add-user|add-role] ...');
  }
}

module.exports = { initRBAC, hasPermission, addUser, addRole };
