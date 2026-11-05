const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

/* GET /tiles/:z/:x/:y.png  Map tiles, fetched by this server instead of the visitor's browser.
   OpenStreetMap refuses ("403 Access blocked") browser requests that come from tunnel/port-forward addresses or carry no
   usable Referer. A request from the server with an identifying User-Agent follows OSM's tile usage policy, and tiles
   are cached here so OSM is hit as little as possible. Set TILE_USER_AGENT in .env to name your app and a contact. */
const UA = process.env.TILE_USER_AGENT || 'TunTon/0.1 (school project, Dagupan City lost pet platform)';
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 900, standardHeaders: true, legacyHeaders: false,
  message: 'Too many tile requests.' });

const cache = new Map();            // "z/x/y" -> { at, buf }
const MAX = 800, TTL = 24 * 60 * 60 * 1000;
const pending = new Map();          // de-duplicates simultaneous requests for one tile

router.get('/:z/:x/:y.png', limiter, async (req, res) => {
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= n || y >= n) return res.status(400).end();
  const key = `${z}/${x}/${y}`;
  const send = buf => res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(buf);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return send(hit.buf);
  try {
    if (!pending.has(key)) {
      pending.set(key, (async () => {
        const r = await fetch(`https://tile.openstreetmap.org/${key}.png`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('tile ' + r.status);
        return Buffer.from(await r.arrayBuffer());
      })().finally(() => pending.delete(key)));
    }
    const buf = await pending.get(key);
    cache.set(key, { at: Date.now(), buf });
    if (cache.size > MAX) cache.delete(cache.keys().next().value);
    send(buf);
  } catch { if (hit) send(hit.buf); else res.status(502).end(); }
});

module.exports = router;
