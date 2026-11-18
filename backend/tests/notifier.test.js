/* Unit tests for match e-mails: message text and queueing rules (no database or SMTP needed). Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessage, buildClaimMessage, queueMatchEmail, queueClaimEmail } = require('../services/notifier');

const owner = { report_id: 5, user_id: 1, type: 'lost', pet_name: 'Bantay', species: 'Dog', breed: 'Aspin', color: 'Brown', size: 'medium', event_date: '2026-10-01', barangay: 'Pantal', email: 'owner@example.com', full_name: 'Ana Cruz', user_status: 'active' };
const fresh = { report_id: 9, user_id: 2, type: 'found', pet_name: 'Unknown', species: 'Dog', breed: 'Aspin', color: 'Brown', size: 'medium', event_date: '2026-10-02', barangay: 'Lucao', email: 'finder@example.com', phone: '09171234567', full_name: 'Ben Lim', user_status: 'active' };

test('message names the match, links to the owner\'s report and hides the finder\'s contact details', () => {
  const m = buildMessage({ ownerName: 'Ana', ownerReport: owner, newReport: fresh, score: 87.5, label: 'Strong', url: 'http://x/r?id=5' });
  assert.match(m.subject, /Strong match for your lost pet report "Bantay"/);
  assert.match(m.text, /new found report/);
  assert.match(m.text, /http:\/\/x\/r\?id=5/);
  assert.ok(!/finder@example\.com|09171234567/.test(m.text + m.html), 'no contact details of the other user');
});

test('html is escaped', () => {
  const m = buildMessage({ ownerName: '<b>Ana</b>', ownerReport: owner, newReport: { ...fresh, color: '<script>' }, score: 50, label: 'Possible', url: 'http://x' });
  assert.ok(!m.html.includes('<script>') && !m.html.includes('<b>Ana'));
});

/* Fake connection: answers the two report lookups, records the INSERT. */
const fakeConn = reports => {
  const inserts = [];
  return { inserts, query: async (sql, p) => sql.startsWith('INSERT') ? (inserts.push(p), [{ affectedRows: 1 }]) : [[reports[p[0]]]] };
};
const args = { ownerReportId: 5, newReportId: 9, lostId: 5, foundId: 9, score: 80, label: 'Strong' };

test('queues one e-mail for the owner of the existing report', async () => {
  const c = fakeConn({ 5: owner, 9: fresh });
  assert.equal(await queueMatchEmail(c, args), true);
  assert.equal(c.inserts.length, 1);
  assert.deepEqual(c.inserts[0].slice(0, 4), [1, 5, 9, 'owner@example.com']);
  assert.match(c.inserts[0][5], /\/pages\/user\/dashboard\/matching\?report=5\b/, 'links to the owner\'s Matching tab');
});

test('does not queue for a suspended owner, a missing e-mail, or the same user', async () => {
  for (const o of [{ ...owner, user_status: 'suspended' }, { ...owner, email: '' }, { ...owner, user_id: 2 }]) {
    const c = fakeConn({ 5: o, 9: fresh });
    assert.equal(await queueMatchEmail(c, args), false);
    assert.equal(c.inserts.length, 0);
  }
});

test('only strong matches are queued (score 80+)', async () => {
  const weak = fakeConn({ 5: owner, 9: fresh });
  assert.equal(await queueMatchEmail(weak, { ...args, score: 79.99, label: 'Likely' }), false);
  assert.equal(weak.inserts.length, 0);
  const strong = fakeConn({ 5: owner, 9: fresh });
  assert.equal(await queueMatchEmail(strong, { ...args, score: 80 }), true);
});

/* ---- Claim e-mails ---- */
const claimRow = { claim_id: 12, claim_type: 'found_it', description: 'I found him near the market, he is safe with me.', markings: 'white patch', pet_location: 'Pantal market',
  event_date: '2026-10-03', claimant_user_id: 2, claimant_name: 'Ben Lim', report_id: 5, owner_id: 1, type: 'lost', pet_name: 'Bantay',
  email: 'owner@example.com', owner_name: 'Ana Cruz', user_status: 'active' };
const claimConn2 = row => { const calls = []; return { calls, query: async (sql, p) => sql.startsWith('INSERT') ? (calls.push(p), [{ affectedRows: 1 }]) : [[row]] }; };

test('claim message says who claimed what and hides the claimant\'s contact details', () => {
  const m = buildClaimMessage({ ownerName: 'Ana', report: claimRow, claim: { ...claimRow, phone: '09171234567', claimant_email: 'ben@example.com' }, url: 'http://x/report?id=5' });
  assert.match(m.subject, /New claim on your lost pet report "Bantay"/);
  assert.match(m.text, /Ben sent a claim on your lost report "Bantay": they say they found this pet\./);
  assert.match(m.text, /Seen at: Pantal market/);
  assert.match(m.text, /http:\/\/x\/report\?id=5/);
  assert.ok(!/09171234567|ben@example\.com/.test(m.text + m.html));
  assert.match(buildClaimMessage({ ownerName: 'Ana', report: { ...claimRow, type: 'found' }, claim: { ...claimRow, claim_type: 'my_pet' }, url: 'u' }).text, /they say this is their pet/);
});

test('long claim text is shortened and html-escaped', () => {
  const m = buildClaimMessage({ ownerName: 'Ana', report: claimRow, claim: { ...claimRow, description: '<b>' + 'x'.repeat(400) }, url: 'u' });
  assert.ok(!m.html.includes('<b>') && m.text.includes('\u2026'));
});

test('queues one e-mail to the owner of the claimed report', async () => {
  const c = claimConn2(claimRow);
  assert.equal(await queueClaimEmail(c, 12), true);
  assert.deepEqual(c.calls[0].slice(0, 3), [1, 12, 'owner@example.com']);
  assert.match(c.calls[0][4], /\/pages\/user\/dashboard\/report\?id=5\b/);
});

test('no claim e-mail for a suspended owner, a missing e-mail, a missing claim or a self-claim', async () => {
  for (const row of [{ ...claimRow, user_status: 'suspended' }, { ...claimRow, email: '' }, undefined, { ...claimRow, claimant_user_id: 1 }]) {
    const c = claimConn2(row);
    assert.equal(await queueClaimEmail(c, 12), false);
    assert.equal(c.calls.length, 0);
  }
});

test('layout: title and subtitle in the header, **bold** markers become <strong> in html and vanish in text', () => {
  const m = buildMessage({ ownerName: 'Ana', ownerReport: owner, newReport: fresh, score: 87.5, label: 'Strong', url: 'http://x' });
  assert.match(m.html, /Strong match found/);
  assert.match(m.html, /<strong>&quot;Bantay&quot;<\/strong>/);
  assert.ok(!m.text.includes('**') && !m.html.includes('**'));
  assert.match(m.text, /^Strong match found\nFor your lost pet "Bantay"/);
});