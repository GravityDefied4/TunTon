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
app.use('/api', require('./routes/matches'));          // /api/matching/run/:id and /api/matches/*
app.use('/api/claims', require('./routes/claims'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', notFound);

/* ---- Uploads ----
   Pet photos are shown on public report cards, so they are served read-only from /uploads/reports
   (random file names, no directory listing). Proof documents are NOT served here: they are private and
   only delivered by GET /api/claims/:id/proofs/:proofId/file after a permission check. */
app.use('/uploads/reports', express.static(path.join(__dirname, 'uploads', 'reports'),
  { index: false, dotfiles: 'deny', maxAge: '1d', setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));

/* ---- Frontend ---- */
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`TunTon running at http://localhost:${port}`));
