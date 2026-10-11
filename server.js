require('dotenv').config();
const path = require('path');
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

/* ---- Frontend ----
   Uploaded photos are NOT served as a public folder: pet photos and proof documents
   will be delivered through controllers that check permissions (proofs are private). */
app.use(express.static(path.join(__dirname, 'frontend')));

app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`TunTon running at http://localhost:${port}`));
