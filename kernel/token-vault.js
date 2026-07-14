'use strict';
const crypto = require('crypto');
const TOKEN_SCOPE = Object.freeze({
  AGENT_COMMUNICATION: 'AGENT_COMMUNICATION',
  KERNEL_ADMIN: 'KERNEL_ADMIN'
});
class TokenVault {
  constructor() {
    this._tokens = new Map();
  }
  issueToken(agentId, scope) {
    const token = crypto.randomBytes(32).toString('hex');
    this._tokens.set(token, { agentId, scope, createdAt: Date.now() });
    return token;
  }
  validateToken(token, scope) {
    const record = this._tokens.get(token);
    if (!record) return false;
    return record.scope === scope;
  }
}
const vault = new TokenVault();
module.exports = { vault, TOKEN_SCOPE };
