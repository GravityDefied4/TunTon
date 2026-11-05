const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

/* GET /api/geo/ip  Approximate location of the caller, used only when the browser refuses GPS
   (page not on https/localhost, e.g. port forwarding). City-level accuracy at best. Returns { lat, lng, approx: true }. */
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many requests. Try again shortly.' } });

const cache = new Map();   // ip -> { at, value }
const TTL = 10 * 60 * 1000;
const isPrivate = ip => !ip || /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip.replace(/^::ffff:/i, ''));

router.get('/ip', limiter, async (req, res) => {
  const ip = (req.ip || '').replace(/^::ffff:/i, '');
  /* A private/loopback caller is on this machine's network, so this server's own public IP is the right guess. */
  const key = isPrivate(ip) ? 'self' : ip;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return res.ok(hit.value);
  try {
    const r = await fetch(`https://ipwho.is/${key === 'self' ? '' : encodeURIComponent(key)}?fields=success,latitude,longitude`, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    if (!j.success || !isFinite(j.latitude) || !isFinite(j.longitude)) throw new Error('lookup failed');
    const value = { lat: j.latitude, lng: j.longitude, approx: true };
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    res.ok(value);
  } catch { res.fail(503, 'Could not estimate your location.'); }
});

module.exports = router;
