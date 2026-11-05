const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });  // .env lives in the project root
const express = require('express');
const cors = require('cors');
const { responseHelpers, notFound, errorHandler } = require('./middleware/errorHandler');

const placeholder = v => !v || v.startsWith('YOUR_');
if (placeholder(process.env.GOOGLE_CLIENT_ID)) console.warn('[warn] GOOGLE_CLIENT_ID is not set in .env. Google sign-in will not work.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set in .env (at least 32 characters).');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
/* Port forwarding / tunnels (VS Code Ports, ngrok, cloudflared...) put a proxy in front of this server. Without this,
   every visitor shows up as the tunnel's IP, so the login/preview rate limits are shared by everyone and req.ip is wrong.
   Default trusts only proxies on this machine (the tunnel agent connects from loopback), so a direct client cannot fake
   X-Forwarded-For. Override with TRUST_PROXY (a hop count like 1, or a subnet list) if your setup differs. */
const tp = process.env.TRUST_PROXY;
app.set('trust proxy', tp === undefined || tp === '' ? 'loopback, linklocal, uniquelocal' : (/^\d+$/.test(tp) ? Number(tp) : tp));
app.use(express.json({ limit: '100kb' }));
app.use(responseHelpers);

const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use('/api', cors({ origin: origins, allowedHeaders: ['Content-Type', 'Authorization'] }));

/* ---- API ---- */
app.get('/api/health', (req, res) => res.ok({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/geofence', require('./routes/geofence'));
app.use('/tiles', require('./routes/tiles'));          // map tiles, proxied so tunnels are not blocked by OpenStreetMap
app.use('/api/geo', require('./routes/geo'));          // approximate location fallback when browser GPS is blocked
app.use('/api', require('./routes/matches'));          // /api/matching/run/:id and /api/matches/*
app.use('/api/claims', require('./routes/claims'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', notFound);

/* ---- Uploads ----
   Pet photos are shown on public report cards, so they are served read-only from /uploads/reports
   (random file names, no directory listing). Claim photos are served below by their random name; the API only
   lists those names to the report's owner (pending claims) or everyone (approved claims). */
/* Report photos live in the database (report_photos.image_data). Older photos that were saved as files
   fall through to the static folder below. */
const pool = require('./db/pool');
app.get('/uploads/reports/:name', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT image_data, mime_type FROM report_photos WHERE file_path = ? AND image_data IS NOT NULL LIMIT 1', [req.params.name]);
    if (!rows[0]) return next();
    res.set({ 'Content-Type': rows[0].mime_type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' });
    res.send(rows[0].image_data);
  } catch (e) { next(e); }
});
/* Claim photos (also kept in the database, see claim_photos). */
app.get('/uploads/claims/:name', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT image_data, mime_type FROM claim_photos WHERE file_path = ? LIMIT 1', [req.params.name]);
    if (!rows[0]) return res.status(404).end();
    res.set({ 'Content-Type': rows[0].mime_type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
    res.send(rows[0].image_data);
  } catch (e) { next(e); }
});
app.use('/uploads/reports', express.static(path.join(__dirname, 'uploads', 'reports'),
  { index: false, dotfiles: 'deny', maxAge: '1d', setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));

/* Profile pictures are shown on report cards too, so they are public like report photos (random names, no listing). */
app.use('/uploads/avatars', express.static(path.join(__dirname, 'uploads', 'avatars'),
  { index: false, dotfiles: 'deny', maxAge: '1h', setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));

/* ---- Frontend ---- */
/* Clean URLs: /pages/user/dashboard/add-report?match=1 instead of add-report.html?match=1.
   An old .html address is redirected to the clean one (query string kept), and the clean one serves the .html file.
   index.html is the home page, so it becomes '/'. */
app.use((req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.path.endsWith('.html')) return next();
  const clean = req.path.slice(0, -5).replace(/\/index$/, '/') || '/';
  res.redirect(301, clean + req.originalUrl.slice(req.path.length));
});
app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions: ['html'] }));

app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;

/* Optional HTTPS. Browsers only allow GPS location (and Google sign-in) on https:// pages or localhost, so a plain
   http://192.168.x.x:3000 or http tunnel loses both. Set SSL_KEY_FILE and SSL_CERT_FILE (e.g. made with mkcert) to serve https directly. */
const { SSL_KEY_FILE, SSL_CERT_FILE, PUBLIC_URL } = process.env;
let server, scheme = 'http';
if (SSL_KEY_FILE && SSL_CERT_FILE) {
  const fs = require('fs');
  server = require('https').createServer({ key: fs.readFileSync(SSL_KEY_FILE), cert: fs.readFileSync(SSL_CERT_FILE) }, app);
  scheme = 'https';
} else server = require('http').createServer(app);

server.listen(port, () => {
  console.log(`TunTon running at ${scheme}://localhost:${port}`);
  if (PUBLIC_URL) {
    console.log(`Public address: ${PUBLIC_URL}`);
    console.log(`  Google sign-in: add exactly this under "Authorized JavaScript origins": ${PUBLIC_URL.replace(/\/+$/, '')}`);
    if (!/^https:/i.test(PUBLIC_URL)) console.warn('  [warn] PUBLIC_URL is not https: browsers will block GPS location and Google sign-in there. Use an https tunnel.');
  }
});