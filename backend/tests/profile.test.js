/* Profile phone + picture endpoints: real routes/controller/multer, user store and activity log faked (no MySQL needed). */
process.env.JWT_SECRET = 'x'.repeat(40);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');

const me = { user_id: 1, full_name: 'Juan Dela Cruz', given_name: 'Juan', email: 'juan@example.com', phone: null, picture: null, role: 'user', status: 'active' };
const fake = {
  findById: async () => ({ ...me }),
  updateProfile: async (id, ch) => Object.assign(me, ch) && { ...me },
  setPicture: async (id, url) => { me.picture = url; return { ...me }; }
};
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../db/userStore', fake);
stub('../db/activityLog', { logActivity: async () => {} });

const { responseHelpers, errorHandler } = require('../middleware/errorHandler');
const app = express();
app.use(express.json());
app.use(responseHelpers);
app.use('/api/users', require('../routes/users'));
app.use(errorHandler);

const AVATARS = path.join(__dirname, '..', 'uploads', 'avatars');
const token = jwt.sign({ role: 'user' }, process.env.JWT_SECRET, { subject: '1' });
const auth = { Authorization: 'Bearer ' + token };
let server, base;
test.before(async () => { await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/users/me`; });
test.after(() => server.close());

const put = async body => { const r = await fetch(base, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const upload = async (bytes, type, name) => {
  const form = new FormData(); form.append('picture', new Blob([bytes], { type }), name);
  const r = await fetch(base + '/picture', { method: 'POST', headers: auth, body: form }); return { status: r.status, body: await r.json() };
};
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const files = () => fs.readdirSync(AVATARS).filter(f => f !== '.gitkeep');

test('phone: spaces, hyphens and +63 are normalized to the stored 09 form', async () => {
  assert.equal((await put({ phone: '0917 123-4567' })).body.data.user.phone, '09171234567');
  assert.equal((await put({ phone: '+63 917 123 4567' })).body.data.user.phone, '09171234567');
  assert.equal((await put({ phone: '' })).body.data.user.phone, null);
});

test('phone: junk and non-strings are rejected', async () => {
  assert.equal((await put({ phone: '12345' })).status, 400);
  assert.equal((await put({ phone: 'abc' })).status, 400);
  assert.equal((await put({ phone: { a: 1 } })).status, 400);
});

test('picture: needs login', async () => {
  const r = await fetch(base + '/picture', { method: 'POST' });
  assert.equal(r.status, 401);
});

test('picture: a real image is saved under a random name and replaces the old one', async () => {
  const before = files().length;
  const a = await upload(JPEG, 'image/jpeg', '../../evil.jpg');
  assert.equal(a.status, 200);
  assert.match(a.body.data.user.picture, /^\/uploads\/avatars\/[0-9a-f-]{36}\.jpg$/);   // what the browser gets
  assert.match(me.picture, /^[0-9a-f-]{36}\.jpg$/);                                          // what the database keeps: file name only
  assert.equal(files().length, before + 1);
  const first = a.body.data.user.picture;
  const b = await upload(JPEG, 'image/jpeg', 'again.jpg');
  assert.equal(b.status, 200);
  assert.notEqual(b.body.data.user.picture, first);
  assert.equal(files().length, before + 1, 'old avatar file is deleted');
});

test('picture: wrong type or fake image content is rejected and leaves no file behind', async () => {
  const before = files().length;
  assert.equal((await upload(Buffer.from('<script>alert(1)</script>'), 'image/jpeg', 'x.jpg')).status, 400);   // claims JPEG, is not
  assert.equal((await upload(Buffer.from('hello'), 'text/html', 'x.html')).status, 400);
  assert.equal((await fetch(base + '/picture', { method: 'POST', headers: auth })).status, 400);              // no file at all
  assert.equal(files().length, before);
});

test('picture: remove clears it and deletes the file', async () => {
  const r = await fetch(base + '/picture', { method: 'DELETE', headers: auth });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.user.picture, null);
  assert.equal(me.picture, null);
  assert.equal(files().length, 0);
});
