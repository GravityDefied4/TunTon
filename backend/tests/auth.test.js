/* Email + password auth: real routes and controller, with the user store replaced by an in-memory fake (no MySQL needed). */
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.ADMIN_EMAILS = 'boss@example.com';   // legacy var: must have no effect any more
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const rows = [];
const strip = ({ password_hash, ...u }) => ({ ...u, picture: null, given_name: u.full_name.split(' ')[0] });
const fakeStore = {
  findById: async id => { const u = rows.find(r => r.user_id === Number(id)); return u ? strip(u) : null; },
  findByEmail: async e => { const u = rows.find(r => r.email === e); return u ? strip(u) : null; },
  findByGoogleSub: async () => null,
  findCredentials: async e => rows.find(r => r.email === e) || null,
  createWithPassword: async ({ email, full_name, password_hash }) => {
    const u = { user_id: rows.length + 1, email, full_name, password_hash, role: 'user', status: 'active' };
    rows.push(u); return strip(u);
  },
  markLogin: async id => fakeStore.findById(id)
};
const storePath = require.resolve('../db/userStore');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const { responseHelpers, errorHandler } = require('../middleware/errorHandler');
const app = express();
app.use(express.json());
app.use(responseHelpers);
app.use('/api/auth', require('../routes/auth'));
app.use(errorHandler);

let server, base;
test.before(async () => { await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/auth`; });
test.after(() => server.close());

const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

test('register creates a user, hashes the password, returns a verifiable JWT', async () => {
  const r = await post('/register', { name: 'Juan Dela Cruz', email: ' Juan@Example.com ', password: 'hunter2hunter2' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.user.email, 'juan@example.com');
  assert.equal(r.body.data.user.password_hash, undefined);
  assert.equal(jwt.verify(r.body.data.token, process.env.JWT_SECRET).sub, String(r.body.data.user.id));
  assert.ok(await bcrypt.compare('hunter2hunter2', rows[0].password_hash));
  assert.notEqual(rows[0].password_hash, 'hunter2hunter2');
});

test('register never grants admin, even if ADMIN_EMAILS is still set (it is ignored)', async () => {
  const r = await post('/register', { name: 'Not The Boss', email: 'boss@example.com', password: 'password123' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.user.role, 'user');
});

test('register rejects duplicates, bad input and non-string fields', async () => {
  assert.equal((await post('/register', { name: 'Juan', email: 'juan@example.com', password: 'password123' })).status, 409);
  assert.equal((await post('/register', { name: 'J', email: 'a@b.co', password: 'password123' })).status, 400);
  assert.equal((await post('/register', { name: 'Jane Doe', email: 'nope', password: 'password123' })).status, 400);
  assert.equal((await post('/register', { name: 'Jane Doe', email: 'jane@example.com', password: 'short' })).status, 400);
  assert.equal((await post('/register', { name: 'Jane Doe', email: 'jane@example.com', password: 'a'.repeat(73) })).status, 400);
  assert.equal((await post('/register', { name: 'Jane Doe', email: { a: 1 }, password: 'password123' })).status, 400);
  assert.equal((await post('/register', { name: 'Jane Doe', email: 'jane@example.com', password: ['x'] })).status, 400);
  assert.equal((await post('/register', {})).status, 400);
});

test('login works with the right password and is case-insensitive on email', async () => {
  const r = await post('/login', { email: 'JUAN@example.com', password: 'hunter2hunter2' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.user.name, 'Juan Dela Cruz');
});

test('login gives one identical message for wrong password, unknown email and Google-only accounts', async () => {
  rows.push({ user_id: 99, email: 'g@example.com', full_name: 'Google Only', password_hash: null, role: 'user', status: 'active' });
  const a = await post('/login', { email: 'juan@example.com', password: 'wrong-password' });
  const b = await post('/login', { email: 'ghost@example.com', password: 'whatever123' });
  const c = await post('/login', { email: 'g@example.com', password: 'whatever123' });
  for (const r of [a, b, c]) assert.equal(r.status, 401);
  assert.equal(a.body.message, b.body.message);
  assert.equal(b.body.message, c.body.message);
});

test('login blocks suspended accounts and rejects non-string fields', async () => {
  rows.push({ user_id: 100, email: 's@example.com', full_name: 'Suspended', password_hash: await bcrypt.hash('password123', 4), role: 'user', status: 'suspended' });
  assert.equal((await post('/login', { email: 's@example.com', password: 'password123' })).status, 403);
  assert.equal((await post('/login', { email: { $ne: '' }, password: 'x' })).status, 400);
  assert.equal((await post('/login', { email: 'juan@example.com', password: { a: 1 } })).status, 400);
});

test('seed.sql password hash really is password123', () => {
  const sql = require('fs').readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
  const hash = /'(\$2[aby]\$10\$[^']+)'/.exec(sql)[1];
  assert.ok(bcrypt.compareSync('password123', hash));
});
