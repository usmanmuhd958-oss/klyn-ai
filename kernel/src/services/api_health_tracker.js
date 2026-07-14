/**
 * =============================================================================
 * KLYN AI OS — API Health Tracker
 * File: kernel/src/services/api_health_tracker.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Tracks LLM API health metrics (latency, error rates, availability)
 *   per provider. Used by LLM Monitor to make intelligent routing decisions.
 *
 * =============================================================================
 */

'use strict';

const { createLogger } = require('../observability/logger');

const log = createLogger('APIHealthTracker');

class APIHealthTracker {

  constructor() {
    /**
     * Health records per provider. Key = provider name.
     * @type {Map<string, HealthRecord>}
     */
    this._providers = new Map();
  }

  /**
   * Records an API request result.
   * @param {string}  provider
   * @param {boolean} success
   * @param {number}  latencyMs
   * @param {string}  [errorMsg]
   */
  recordRequest(provider, success, latencyMs, errorMsg = null) {
    if (!this._providers.has(provider)) {
      this._providers.set(provider, new HealthRecord(provider));
    }

    const record = this._providers.get(provider);
    record.addSample(success, latencyMs, errorMsg);
  }

  /**
   * Gets health metrics for a specific provider.
   * @param {string} provider
   * @returns {{ available: boolean, errorRate: number, avgLatencyMs: number, lastError: string|null }}
   */
  getProviderHealth(provider) {
    const record = this._providers.get(provider);
    if (!record) {
      return {
        available:    false,
        errorRate:    1.0,
        avgLatencyMs: 0,
        lastError:    'No health data available.',
      };
    }

    return record.getMetrics();
  }

  /**
   * Returns a snapshot of all provider health data.
   * @returns {object}
   */
  getSnapshot() {
    const snapshot = {};
    for (const [provider, record] of this._providers) {
      snapshot[provider] = record.getMetrics();
    }
    return snapshot;
  }
}

/**
 * Tracks health metrics for a single API provider.
 */
class HealthRecord {
  constructor(provider) {
    this.provider     = provider;
    this.totalRequests = 0;
    this.totalErrors   = 0;
    this.totalLatency  = 0;
    this.lastError     = null;
    this.lastErrorAt   = null;

    /** Rolling window of last 100 samples */
    this._samples = [];
    this._maxSamples = 100;
  }

  addSample(success, latencyMs, errorMsg) {
    this.totalRequests++;
    if (!success) {
      this.totalErrors++;
      this.lastError   = errorMsg;
      this.lastErrorAt = Date.now();
    }
    this.totalLatency += latencyMs;

    this._samples.push({ success, latencyMs, ts: Date.now() });
    if (this._samples.length > this._maxSamples) {
      this._samples.shift();
    }
  }

  getMetrics() {
    const errorRate = this.totalRequests > 0
      ? this.totalErrors / this.totalRequests
      : 0;

    const avgLatency = this.totalRequests > 0
      ? this.totalLatency / this.totalRequests
      : 0;

    const available = errorRate < 0.5;  // Consider available if <50% errors

    return {
      available,
      errorRate,
      avgLatencyMs: Math.round(avgLatency),
      lastError:    this.lastError,
      lastErrorAt:  this.lastErrorAt,
      totalRequests: this.totalRequests,
    };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let _trackerInstance = null;

function getAPIHealthTracker() {
  if (!_trackerInstance) {
    _trackerInstance = new APIHealthTracker();
  }
  return _trackerInstance;
}

module.exports = Object.freeze({
  getAPIHealthTracker,
  APIHealthTracker,
});
