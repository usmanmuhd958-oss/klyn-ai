'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CRYPTO_CONFIG = {
  ALGORITHM: 'aes-256-gcm',
  KEY_LENGTH: 32,
  IV_LENGTH: 16,
  AUTH_TAG_LENGTH: 16,
  SALT_LENGTH: 64,
  ITERATIONS: 100000,
  DIGEST: 'sha256',
  SIGNATURE_ALGORITHM: 'sha256'
};

class KeyManager {
  [key: string]: any;
  keystorePath: any;
  masterKey: any;
  agentKeys: any = new Map();

  constructor(keystorePath = null) {
    this.keystorePath = keystorePath || path.join(process.cwd(), '.klyn', 'keystore');
    this.masterKey = null;
    this.agentKeys = new Map();
    this._ensureKeystore();
  }
  _ensureKeystore() {
    try {
      const dir = path.dirname(this.keystorePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (error) { throw new Error(`Failed to create keystore: ${error.message}`); }
  }
  async initializeMasterKey() {
    try {
      if (fs.existsSync(this.keystorePath)) {
        const data = fs.readFileSync(this.keystorePath, 'utf8');
        const parsed = JSON.parse(data);
        this.masterKey = Buffer.from((parsed as any).masterKey, 'hex');
        if ((parsed as any).agentKeys) {
          Object.entries((parsed as any).agentKeys).forEach(([agentId, key]) => { this.agentKeys.set(agentId, Buffer.from(key as any, 'hex')); });
        }
      } else {
        this.masterKey = crypto.randomBytes(CRYPTO_CONFIG.KEY_LENGTH);
        await this._saveKeystore();
      }
      return true;
    } catch (error) { throw new Error(`Master key initialization failed: ${error.message}`); }
  }
  generateAgentKey(agentId) {
    if (this.agentKeys.has(agentId)) return this.agentKeys.get(agentId);
    const agentKey = crypto.pbkdf2Sync(this.masterKey, agentId, CRYPTO_CONFIG.ITERATIONS, CRYPTO_CONFIG.KEY_LENGTH, CRYPTO_CONFIG.DIGEST);
    this.agentKeys.set(agentId, agentKey);
    this._saveKeystore();
    return agentKey;
  }
  getAgentKey(agentId) { return this.agentKeys.has(agentId) ? this.agentKeys.get(agentId) : this.generateAgentKey(agentId); }
  async _saveKeystore() {
    try {
      const data = { masterKey: this.masterKey.toString('hex'), agentKeys: Object.fromEntries(Array.from(this.agentKeys.entries()).map(([k, v]) => [k, v.toString('hex')])), created: Date.now() };
      fs.writeFileSync(this.keystorePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (error) { throw new Error(`Failed to save keystore: ${error.message}`); }
  }
  async rotateMasterKey() {
    const oldKey = this.masterKey;
    this.masterKey = crypto.randomBytes(CRYPTO_CONFIG.KEY_LENGTH);
    const agentIds = Array.from(this.agentKeys.keys());
    this.agentKeys.clear();
    agentIds.forEach(id => this.generateAgentKey(id));
    await this._saveKeystore();
    return true;
  }
}

class CryptoService {
  [key: string]: any;
  keyManager: any;

  constructor(keyManager) { this.keyManager = keyManager; }
  signMessage(message, agentId) {
    try {
      const key = this.keyManager.getAgentKey(agentId);
      const hmac = crypto.createHmac(CRYPTO_CONFIG.SIGNATURE_ALGORITHM, key);
      const messageData = typeof message === 'string' ? message : JSON.stringify(message);
      hmac.update(messageData);
      return hmac.digest('hex');
    } catch (error) { throw new Error(`Message signing failed: ${error.message}`); }
  }
  verifySignature(message, signature, agentId) {
    try {
      const expectedSignature = this.signMessage(message, agentId);
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
    } catch (error) { return false; }
  }
  encrypt(data, agentId) {
    try {
      const key = this.keyManager.getAgentKey(agentId);
      const iv = crypto.randomBytes(CRYPTO_CONFIG.IV_LENGTH);
      const cipher = crypto.createCipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      return { encrypted, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
    } catch (error) { throw new Error(`Encryption failed: ${error.message}`); }
  }
  decrypt(encryptedData, agentId) {
    try {
      const key = this.keyManager.getAgentKey(agentId);
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      const decipher = crypto.createDecipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      try { return JSON.parse(decrypted); } catch { return decrypted; }
    } catch (error) { throw new Error(`Decryption failed: ${error.message}`); }
  }
  generateToken(length = 32) { return crypto.randomBytes(length).toString('hex'); }
  hash(data, salt = null) {
    const actualSalt = salt || crypto.randomBytes(CRYPTO_CONFIG.SALT_LENGTH);
    const hash = crypto.pbkdf2Sync(data, actualSalt, CRYPTO_CONFIG.ITERATIONS, CRYPTO_CONFIG.KEY_LENGTH, CRYPTO_CONFIG.DIGEST);
    return { hash: hash.toString('hex'), salt: actualSalt.toString('hex') };
  }
  verifyHash(data, hashedData, salt) {
    const result = this.hash(data, Buffer.from(salt, 'hex'));
    return crypto.timingSafeEqual(Buffer.from(result.hash, 'hex'), Buffer.from(hashedData, 'hex'));
  }
}

async function initializeCrypto(keystorePath = null) {
  const keyManager = new KeyManager(keystorePath);
  await keyManager.initializeMasterKey();
  return new CryptoService(keyManager);
}

module.exports = { CryptoService, KeyManager, initializeCrypto, CRYPTO_CONFIG };


export {};
