'use strict';
import crypto from 'node:crypto';
const TOKEN_SCOPE = Object.freeze({
  AGENT_COMMUNICATION: 'AGENT_COMMUNICATION',
  KERNEL_ADMIN: 'KERNEL_ADMIN'
});
class TokenVault {
  [key: string]: any;
  _tokens: any = new Map();

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
    return (record as any).scope === scope;
  }
}
const vault = new TokenVault();
export { vault, TOKEN_SCOPE };


export {};
