/**
 * KLYN AI OS – In‑Memory Rate Limiter (hardened)
 *
 * - Periodic sweep purges expired client buckets so the Map cannot grow
 *   unboundedly under sustained traffic (memory-leak DoS fix).
 * - Optional trusted-proxy support: when `trustProxyHeaders` is enabled the
 *   client key is taken from the FIRST X-Forwarded-For hop, validated against
 *   IPv4/IPv6 shapes so a header injection cannot spoof an arbitrary key.
 *
 * Usage (in api/server.js):
 *   import { rateLimiter } from '../kernel/src/services/rate_limiter.js';
 */
export const rateLimiter = (opts: any = {}) => {
  const windowMs = opts.windowMs || 60000;
  const max      = opts.max || 100;
  const trustProxyHeaders = opts.trustProxyHeaders === true;
  const clients  = new Map();

  // Sweep every window: drop buckets that have fully aged out.
  const sweep = () => {
    const now = Date.now();
    for (const [key, timestamps] of clients) {
      const alive = timestamps.filter(t => now - t < windowMs);
      if (alive.length === 0) {
        clients.delete(key);
      } else {
        clients.set(key, alive);
      }
    }
  };
  const sweepTimer = setInterval(sweep, windowMs);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

  return (req, res, next) => {
    let key = req.ip || req.connection?.remoteAddress || 'unknown';

    // Only trust the proxy header when explicitly configured — otherwise the
    // header is attacker-controlled input and must not drive rate-limit keys.
    if (trustProxyHeaders) {
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string') {
        const first = xff.split(',')[0].trim();
        if (IPV4.test(first) || IPV6.test(first)) key = first;
      }
    }

    const now = Date.now();
    const timestamps = (clients.get(key) || []).filter(t => now - t < windowMs);
    timestamps.push(now);
    // Bound each bucket to `max` entries — the 429 response alone is not
    // enough: without this cap a hammering client could grow an unbounded
    // array inside the window and exhaust memory.
    if (timestamps.length > max) {
      timestamps.splice(0, timestamps.length - max);
      clients.set(key, timestamps);
      return (res as any).status(429).json({ error: 'Too many requests' });
    }
    clients.set(key, timestamps);
    next();
  };
};
