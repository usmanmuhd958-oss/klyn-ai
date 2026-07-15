/**
 * KLYN AI OS – Simple In‑Memory Rate Limiter
 * Usage (in api/server.js):
 *   const { rateLimiter } = require('../kernel/src/services/rate_limiter');
 *   app.use(rateLimiter({ windowMs: 60000, maxRequests: 100 }));
 */
module.exports = {
  rateLimiter: (opts = {}) => {
    const windowMs = opts.windowMs || 60000;
    const max      = opts.max || 100;
    const clients  = new Map();

    return (req, res, next) => {
      const key = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      if (!clients.has(key)) clients.set(key, []);
      const timestamps = clients.get(key).filter(t => now - t < windowMs);
      timestamps.push(now);
      clients.set(key, timestamps);
      if (timestamps.length > max) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      next();
    };
  }
};
