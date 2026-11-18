/* Web push: subscription routes (real routes + controller, in-memory fakes), the endpoint allow-list, sending rules and message text.
   No MySQL, no browser and no real push service needed. Run: npm test */
process.env.JWT_SECRET = 'x'.repeat(40);
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

/* Fake user store: ids 1 and 2 are active, 3 is suspended. */
const people = { 1: { user_id: 1, role: 'user', status: 'active' }, 2: { user_id: 2, role: 'user', status: 'active' }, 3: { user_id: 3, role: 'user', status: 'suspended' } };
const storePath = require.resolve('../db/userStore');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { findById: async id => people[id] || null } };

const push = require('../services/push');
const { responseHelpers, errorHandler } = require('../middleware/errorHandler');

/* Fake database for push.js: remembers saved subscriptions and answers the lookups the notify*() functions make. */
const log = [];
const state = { subs: [], rows: [] };   // rows = what the next SELECT returns
const fakeDb = {
  query: async (sql, params) => {
    log.push({ sql, params });
    if (sql.startsWith('INSERT INTO push_subscriptions')) { state.subs.push({ user_id: params[0], endpoint: params[1], hash: params[2] }); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('DELETE FROM push_subscriptions WHERE endpoint_hash')) { const n = state.subs.length; state.subs = state.subs.filter(s => !(s.hash === params[0] && s.user_id === params[1])); return [{ affectedRows: n - state.subs.length }]; }
    if (sql.startsWith('SELECT')) return [state.rows];
    return [{ affectedRows: 0 }];
  }
};
push._deps.db = fakeDb;

const app = express();
app.use(express.json());
app.use(responseHelpers);
app.use('/api/push', require('../routes/push'));
app.use(errorHandler);
let server, base;
test.before(async () => { await new Promise(r => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}/api/push`; });
test.after(() => server.close());

const token = id => 'Bearer ' + jwt.sign({ sub: id }, process.env.JWT_SECRET);
const call = (path, { id = 1, method = 'GET', body } = {}) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: token(id) } : {}) }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined
});
const goodSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BKey', auth: 'authsecret' } };

test('push is reported as off (503) until VAPID keys are configured', async () => {
  assert.equal(push.enabled(), false);
  assert.equal((await call('/public-key')).status, 503);
  assert.equal((await call('/subscribe', { method: 'POST', body: { subscription: goodSub } })).status, 503);
});

test('with a sender configured: public key is served, and every route needs a login', async () => {
  push._deps.send = async () => {};
  process.env.VAPID_PUBLIC_KEY = 'PUBLIC_KEY_VALUE';
  const r = await call('/public-key');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.publicKey, 'PUBLIC_KEY_VALUE');
  for (const [p, m] of [['/public-key', 'GET'], ['/subscribe', 'POST'], ['/unsubscribe', 'POST']]) assert.equal((await call(p, { id: null, method: m, body: {} })).status, 401, p);
  assert.equal((await call('/public-key', { id: 3 })).status, 403, 'a suspended account is cut off');
});

test('subscribe stores the device under the logged-in user', async () => {
  state.subs = [];
  const r = await call('/subscribe', { method: 'POST', body: { subscription: goodSub } });
  assert.equal(r.status, 201);
  assert.deepEqual(state.subs.map(s => [s.user_id, s.endpoint]), [[1, goodSub.endpoint]]);
  assert.equal(state.subs[0].hash.length, 64);
});

test('subscribe rejects malformed subscriptions', async () => {
  for (const subscription of [undefined, {}, { endpoint: goodSub.endpoint }, { endpoint: goodSub.endpoint, keys: { p256dh: 'a' } }, { endpoint: 5, keys: goodSub.keys }, { endpoint: 'https://fcm.googleapis.com/' + 'x'.repeat(1000), keys: goodSub.keys }]) {
    assert.equal((await call('/subscribe', { method: 'POST', body: { subscription } })).status, 400);
  }
});

test('endpoint allow-list: only real push services (blocks calls to internal or arbitrary addresses)', () => {
  const ok = ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/?token=x'];
  const no = ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://evil.example/x',
    'https://fcm.googleapis.com.evil.example/x', 'https://evilfcm.googleapis.com.attacker.io/', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'not a url', ''];
  for (const u of ok) assert.equal(push.isPushEndpoint(u), true, u);
  for (const u of no) assert.equal(push.isPushEndpoint(u), false, u);
});

test('subscribe refuses an endpoint on a non-push host', async () => {
  state.subs = [];
  const r = await call('/subscribe', { method: 'POST', body: { subscription: { ...goodSub, endpoint: 'https://169.254.169.254/latest/meta-data' } } });
  assert.equal(r.status, 400);
  assert.equal(state.subs.length, 0);
});

test('PUSH_EXTRA_HOSTS adds a host to the allow-list', () => {
  process.env.PUSH_EXTRA_HOSTS = 'push.example.net';
  assert.equal(push.isPushEndpoint('https://push.example.net/x'), true);
  delete process.env.PUSH_EXTRA_HOSTS;
  assert.equal(push.isPushEndpoint('https://push.example.net/x'), false);
});

test('unsubscribe removes only the caller\'s own device', async () => {
  state.subs = [];
  await call('/subscribe', { method: 'POST', body: { subscription: goodSub } });
  await call('/unsubscribe', { id: 2, method: 'POST', body: { endpoint: goodSub.endpoint } });
  assert.equal(state.subs.length, 1, 'another user cannot remove it');
  assert.equal((await call('/unsubscribe', { method: 'POST', body: { endpoint: goodSub.endpoint } })).status, 200);
  assert.equal(state.subs.length, 0);
  assert.equal((await call('/unsubscribe', { method: 'POST', body: {} })).status, 400);
});

test('saving a subscription also trims the user to the newest few devices', async () => {
  log.length = 0;
  await push.saveSubscription(1, goodSub, 'UA');
  const trim = log.find(l => l.sql.startsWith('DELETE FROM push_subscriptions WHERE user_id'));
  assert.deepEqual(trim.params, [1, 1, push.CFG.maxDevices]);
});

/* ---- sending ---- */
const device = n => ({ subscription_id: n, endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, p256dh: 'k' + n, auth: 'a' + n });

test('sendToUser sends the JSON payload to every device with a TTL, and only to active users', async () => {
  const sent = [];
  push._deps.send = async (sub, body, opts) => { sent.push({ sub, body, opts }); };
  state.rows = [device(1), device(2)];
  log.length = 0;
  const out = await push.sendToUser(1, { title: 'Hi', body: 'There', url: '/x' });
  assert.deepEqual(out, { sent: 2, removed: 0 });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].sub, { endpoint: device(1).endpoint, keys: { p256dh: 'k1', auth: 'a1' } });
  assert.deepEqual(JSON.parse(sent[0].body), { title: 'Hi', body: 'There', url: '/x' });
  assert.equal(sent[0].opts.TTL, push.CFG.ttlSeconds);
  assert.match(log[0].sql, /u\.status = 'active'/, 'suspended users are skipped in SQL');
});

test('a 410 / 404 from the push service deletes that subscription; other errors keep it', async () => {
  const errs = { 1: Object.assign(new Error('gone'), { statusCode: 410 }), 2: Object.assign(new Error('nf'), { statusCode: 404 }), 3: Object.assign(new Error('boom'), { statusCode: 500 }) };
  push._deps.send = async sub => { const n = Number(sub.endpoint.split('/').pop()); if (errs[n]) throw errs[n]; };
  state.rows = [device(1), device(2), device(3), device(4)];
  log.length = 0;
  const origError = console.error; console.error = () => {};
  const out = await push.sendToUser(1, { title: 't' });
  console.error = origError;
  assert.deepEqual(out, { sent: 1, removed: 2 });
  const deleted = log.filter(l => l.sql.startsWith('DELETE FROM push_subscriptions WHERE subscription_id')).map(l => l.params[0]).sort();
  assert.deepEqual(deleted, [1, 2]);
});

test('sendToUser never throws, even when the database fails', async () => {
  push._deps.db = { query: async () => { throw new Error('db down'); } };
  const origError = console.error; console.error = () => {};
  const out = await push.sendToUser(1, { title: 't' });
  console.error = origError;
  push._deps.db = fakeDb;
  assert.deepEqual(out, { sent: 0, removed: 0 });
});

/* ---- messages ---- */
test('claim message: who responded, which report, clean link, nothing private', () => {
  const m = push.claimMessage({ claim_id: 7, claimant_name: 'Ben Lim', report_id: 5, report_type: 'lost', pet_name: 'Bantay' });
  assert.equal(m.title, 'Someone may have found your pet');
  assert.equal(m.body, 'Ben responded to your lost report for Bantay.');
  assert.equal(m.url, '/pages/user/dashboard/report?id=5');
  assert.equal(m.tag, 'claim-7');
  assert.equal(push.claimMessage({ claim_id: 8, claimant_name: 'Ana', report_id: 6, report_type: 'found', pet_name: 'Mingming' }).title, 'Someone says this is their pet');
});

test('long or missing pet names are handled', () => {
  assert.ok(push.claimMessage({ claim_id: 1, claimant_name: 'A', report_id: 1, report_type: 'lost', pet_name: 'N'.repeat(200) }).body.length < 120);
  assert.match(push.claimMessage({ claim_id: 1, claimant_name: '', report_id: 1, report_type: 'lost', pet_name: '' }).body, /^A user responded to your lost report for your pet\.$/);
});

test('decision and match messages', () => {
  assert.equal(push.decisionMessage({ claim_id: 3, status: 'approved', report_id: 5, pet_name: 'Bantay' }).title, 'Your response was approved');
  const no = push.decisionMessage({ claim_id: 3, status: 'rejected', report_id: 5, pet_name: 'Bantay' });
  assert.equal(no.title, 'Your response was marked not a match');
  assert.equal(no.url, '/pages/user/dashboard/report?id=5');
  const m = push.matchMessage({ owner_report_id: 5, owner_type: 'lost', new_type: 'found', pet_name: 'Bantay', score: 87.4, label: 'Strong', lost_id: 5, found_id: 9 });
  assert.equal(m.title, 'Strong match found');
  assert.equal(m.body, 'A new found report looks like a strong match (87%) for your lost report "Bantay".');
  assert.equal(m.url, '/pages/user/dashboard/matching?report=5');
  assert.equal(m.tag, 'match-5-9');
});

/* ---- event hooks ---- */
const capture = () => { const sent = []; push._deps.send = async (sub, body) => { sent.push(JSON.parse(body)); }; return sent; };
const queryRouter = answers => { push._deps.db = { query: async (sql, p) => { for (const [re, rows] of answers) if (re.test(sql)) return [rows]; return [[]]; } }; };

test('notifyClaim alerts the owner of the claimed report', async () => {
  const sent = capture();
  const owner = [];
  push._deps.db = { query: async (sql, p) => {
    if (/FROM claims c JOIN users cu/.test(sql)) return [[{ claim_id: 4, claimant_name: 'Ben Lim', report_id: 5, owner_id: 9, report_type: 'found', pet_name: 'Mingming' }]];
    if (/FROM push_subscriptions s/.test(sql)) { owner.push(p[0]); return [[device(1)]]; }
    return [[]];
  } };
  await push.notifyClaim(4);
  assert.deepEqual(owner, [9], 'sent to the report owner, not the claimant');
  assert.equal(sent[0].title, 'Someone says this is their pet');
  push._deps.db = fakeDb;
});

test('notifyClaim does nothing for an unknown claim and never throws', async () => {
  const sent = capture();
  queryRouter([]);
  await push.notifyClaim(999);
  assert.equal(sent.length, 0);
  push._deps.db = { query: async () => { throw new Error('db down'); } };
  const origError = console.error; console.error = () => {};
  await push.notifyClaim(1);
  console.error = origError;
  push._deps.db = fakeDb;
});

test('notifyDecisions alerts each claimant with their own result', async () => {
  const sent = capture(), to = [];
  push._deps.db = { query: async (sql, p) => {
    if (/FROM claims c JOIN pet_reports/.test(sql)) return [[
      { claim_id: 1, claimant_user_id: 11, status: 'approved', report_id: 5, pet_name: 'Bantay' },
      { claim_id: 2, claimant_user_id: 12, status: 'rejected', report_id: 5, pet_name: 'Bantay' },
      { claim_id: 3, claimant_user_id: 13, status: 'pending', report_id: 5, pet_name: 'Bantay' }]];
    if (/FROM push_subscriptions s/.test(sql)) { to.push(p[0]); return [[device(1)]]; }
    return [[]];
  } };
  await push.notifyDecisions([1, 2, 3]);
  assert.deepEqual(to.sort(), [11, 12], 'a still-pending claim is not announced');
  assert.deepEqual(sent.map(s => s.title).sort(), ['Your response was approved', 'Your response was marked not a match']);
  await push.notifyDecisions([]);   // nothing to do
  push._deps.db = fakeDb;
});

test('notifyMatch alerts the owner of the existing report about the new one', async () => {
  const sent = capture(), to = [];
  push._deps.db = { query: async (sql, p) => {
    if (/FROM pet_reports r JOIN pet_reports n/.test(sql)) return [[{ report_id: 5, user_id: 21, report_type: 'lost', pet_name: 'Bantay', new_type: 'found' }]];
    if (/FROM push_subscriptions s/.test(sql)) { to.push(p[0]); return [[device(1)]]; }
    return [[]];
  } };
  await push.notifyMatch({ ownerReportId: 5, newReportId: 9, lostId: 5, foundId: 9, score: 91, label: 'Strong' });
  assert.deepEqual(to, [21]);
  assert.equal(sent[0].body, 'A new found report looks like a strong match (91%) for your lost report "Bantay".');
  push._deps.db = fakeDb;
});
