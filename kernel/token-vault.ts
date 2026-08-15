'use strict';
import crypto from 'node:crypto';

const TOKEN_SCOPE = Object.freeze({
  AGENT_COMMUNICATION: 'AGENT_COMMUNICATION',
  KERNEL_ADMIN: 'KERNEL_ADMIN'
});

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SWEEP_INTERVAL_MS = 60_000;      // background expiry sweep

class TokenVault {
  [key: string]: any;
  _tokens: any = new Map(); // key: sha256(token), value: { agentId, scope, createdAt, expiresAt }
  _sweepTimer: any = null;

  constructor() {
    // Background cleanup keeps the map bounded — expired tokens are purged
    // even if nothing ever validates them again.
    this._sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS);
    if (typeof this._sweepTimer.unref === 'function') {
      this._sweepTimer.unref();
    }
  }

  issueToken(agentId, scope, ttlMs = DEFAULT_TTL_MS) {
    const token = crypto.randomBytes(32).toString('hex');
    this._tokens.set(this._hash(token), {
      agentId,
      scope,
      createdAt: Date.now(),
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0, // 0 = never expires
    });
    return token;
  }

  /**
   * Seed a fixed token (e.g. KLYN_ADMIN_TOKEN from the environment).
   * ttlMs 0 keeps the token valid until process exit — intended for
   * operator-provided admin credentials, never for short-lived agents.
   */
  seed(token, scope, ttlMs = 0) {
    if (!token || typeof token !== 'string') {
      throw new TypeError('TokenVault.seed: token must be a non-empty string');
    }
    this._tokens.set(this._hash(token), {
      agentId: 'admin',
      scope,
      createdAt: Date.now(),
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
    });
  }

  validateToken(token, scope) {
    const key = this._hash(token || '');
    const record = this._tokens.get(key);
    if (!record) return false;
    if (record.expiresAt > 0 && record.expiresAt <= Date.now()) {
      this._tokens.delete(key);
      return false;
    }
    return record.scope === scope;
  }

  revoke(token) {
    return this._tokens.delete(this._hash(token || ''));
  }

  sweepExpired() {
    const now = Date.now();
    for (const [key, record] of this._tokens) {
      if (record.expiresAt > 0 && record.expiresAt <= now) {
        this._tokens.delete(key);
      }
    }
  }

  close() {
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  // Store only sha256(token) — a memory dump never leaks usable tokens.
  _hash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

const vault = new TokenVault();

export { vault, TokenVault, TOKEN_SCOPE };
