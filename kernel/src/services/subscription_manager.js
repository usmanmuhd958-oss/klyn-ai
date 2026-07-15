'use strict';

/**
 * KLYN AI OS – Subscription Manager
 *
 * Reads runtime/clients.json (atomic storage) and validates:
 *   - client existence
 *   - plan type
 *   - expiry date
 *   - allowed models
 *
 * All file operations are atomic (write‑to‑temp → rename) to survive
 * sudden battery loss on mobile.
 */

const fs   = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', '..', 'runtime', 'clients.json');

/**
 * Safely read the client store (returns empty object on failure).
 */
function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[SubscriptionManager] Failed to read store: ${e.message}`);
    return {};
  }
}

/**
 * Atomically write the store.
 */
function writeStore(data) {
  const tmp = STORE_PATH + '.tmp.' + Date.now();
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    console.error(`[SubscriptionManager] Atomic write failed: ${e.message}`);
    throw e;
  }
}

/**
 * Validate a client against the subscription store.
 * @param {string} clientId
 * @param {string} requestedModel – optional model to check
 * @returns {{ valid: boolean, plan: string|null, reason: string|null }}
 */
function validateClient(clientId, requestedModel = null) {
  const store = readStore();
  const client = store[clientId];

  if (!client) {
    return { valid: false, plan: null, reason: 'Unknown client' };
  }

  // Check expiry
  const now = new Date();
  const expires = new Date(client.expiresAt);
  if (isNaN(expires.getTime()) || expires < now) {
    return { valid: false, plan: client.plan, reason: 'Subscription expired' };
  }

  // Check model access
  if (requestedModel && client.allowed_models) {
    if (!client.allowed_models.includes(requestedModel)) {
      return { valid: false, plan: client.plan, reason: `Model "${requestedModel}" not allowed on ${client.plan} plan` };
    }
  }

  return { valid: true, plan: client.plan, reason: null };
}

/**
 * Add or update a client.
 */
function upsertClient(clientId, plan, expiresAt, allowedModels) {
  const store = readStore();
  store[clientId] = {
    plan,
    expiresAt,
    allowed_models: allowedModels
  };
  writeStore(store);
}

/**
 * Remove a client.
 */
function removeClient(clientId) {
  const store = readStore();
  delete store[clientId];
  writeStore(store);
}

module.exports = { validateClient, upsertClient, removeClient };
