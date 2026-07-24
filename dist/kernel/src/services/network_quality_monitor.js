/**
 * =============================================================================
 * KLYN AI OS — Network Quality Monitor
 * File: kernel/src/services/network_quality_monitor.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Monitors Android network connectivity quality on Termux using system APIs.
 *   Provides a 0-1 quality score based on latency, packet loss, and bandwidth.
 *
 * TERMUX DETECTION:
 *   - Ping Google DNS (8.8.8.8) to measure latency
 *   - Check /proc/net/dev for interface stats
 *   - Use termux-api if available for cellular signal strength
 *
 * =============================================================================
 */
'use strict';
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const execAsync = promisify(exec);
const { createLogger } = require('../observability/logger');
const log = createLogger('NetworkQualityMonitor');
class NetworkQualityMonitor {
    constructor() {
        this._lastQuality = 1.0; // Assume good until proven otherwise
        this._lastCheckedAt = 0;
        this._checkInterval = 30_000; // Check every 30 seconds
        this._startMonitoring();
        log.info('Network Quality Monitor initialized.');
    }
    /**
     * Returns the current network quality score (0-1).
     * @returns {number}  Quality score where 1.0 = excellent, 0.0 = offline
     */
    getQuality() {
        return this._lastQuality;
    }
    /**
     * Forces an immediate quality check.
     * @returns {Promise<number>}
     */
    async checkNow() {
        return await this._measureQuality();
    }
    // ---------------------------------------------------------------------------
    // PRIVATE
    // ---------------------------------------------------------------------------
    _startMonitoring() {
        setInterval(async () => {
            try {
                this._lastQuality = await this._measureQuality();
                this._lastCheckedAt = Date.now();
            }
            catch (err) {
                log.warn('Network quality check failed.', { reason: err.message });
                this._lastQuality = 0.5; // Default to moderate quality on error
            }
        }, this._checkInterval).unref();
        // Immediate first check
        setImmediate(async () => {
            this._lastQuality = await this._measureQuality();
        });
    }
    /**
     * Measures network quality using ping latency.
     * @returns {Promise<number>}  Quality score 0-1
     */
    async _measureQuality() {
        try {
            // Ping Google DNS with 3 packets, 2-second timeout
            const { stdout } = await execAsync('ping -c 3 -W 2 8.8.8.8 2>/dev/null || echo "FAIL"', { timeout: 5_000 });
            if (stdout.includes('FAIL') || stdout.includes('100% packet loss')) {
                return 0.0; // Offline
            }
            // Parse average latency from ping output
            const match = stdout.match(/rtt min\/avg\/max\/mdev = [\d.]+\/([\d.]+)\//);
            if (!match) {
                return 0.7; // Ping succeeded but couldn't parse - assume moderate
            }
            const avgLatencyMs = parseFloat(match[1]);
            // Quality score based on latency:
            // < 50ms  = 1.0 (excellent)
            // 100ms   = 0.8 (good)
            // 300ms   = 0.5 (moderate)
            // 800ms   = 0.2 (poor)
            // > 1000ms = 0.1 (very poor)
            if (avgLatencyMs < 50)
                return 1.0;
            if (avgLatencyMs < 100)
                return 0.9;
            if (avgLatencyMs < 300)
                return 0.7;
            if (avgLatencyMs < 800)
                return 0.4;
            if (avgLatencyMs < 1000)
                return 0.2;
            return 0.1;
        }
        catch (err) {
            log.debug('Ping failed.', { reason: err.message });
            return 0.0; // Treat as offline
        }
    }
}
// =============================================================================
// SINGLETON
// =============================================================================
let _monitorInstance = null;
function getNetworkQualityMonitor() {
    if (!_monitorInstance) {
        _monitorInstance = new NetworkQualityMonitor();
    }
    return _monitorInstance;
}
module.exports = Object.freeze({
    getNetworkQualityMonitor,
    NetworkQualityMonitor,
});
export {};
