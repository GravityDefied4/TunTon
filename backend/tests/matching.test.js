/* Unit tests for the pure matching functions. Run: npm test  (node's built-in test runner, no extra deps). */
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../services/matching');

const lost = { type: 'lost', report_id: 1, user_id: 1, status: 'active', species: 'Dog', breed: 'Aspin', breed_unknown: false,
  size: 'medium', sex: 'male', markings: 'white patch on chest', event_date: '2026-10-01',
  lat: 16.0485, lng: 120.3395, search_radius_km: 3, color: 'Brown', primary_color: 'brown', color_names: ['brown'] };
const found = { ...lost, type: 'found', report_id: 2, user_id: 2, event_date: '2026-10-02', lat: 16.0485, lng: 120.3395, search_radius_km: null };

test('identical pet at the same spot is a Strong match (100)', () => {
  const r = m.scoreMatch(lost, { ...found, event_date: '2026-10-01' });
  assert.equal(r.score, 100);
  assert.equal(r.label, 'Strong');
});

test('hard filters', () => {
  assert.ok(m.isCandidate(lost, found));
  assert.ok(!m.isCandidate(lost, { ...found, species: 'Cat' }), 'a dog never matches a cat');
  assert.ok(!m.isCandidate(lost, { ...found, status: 'resolved' }), 'both must be active');
  assert.ok(!m.isCandidate(lost, { ...found, user_id: 1 }), 'own reports never match');
  assert.ok(!m.isCandidate(lost, { ...found, lat: 16.0485 + 0.05 }), 'outside the search radius (about 5.5 km)');
  assert.ok(!m.isCandidate(lost, { ...found, event_date: '2026-09-28' }), 'found long before lost');
  assert.ok(m.isCandidate(lost, { ...found, event_date: '2026-09-29' }), 'inside the 2-day buffer');
  assert.ok(!m.isCandidate(found, lost), 'wrong order of types');
});

test('breed', () => {
  assert.equal(m.scoreBreed(lost, found), 20);
  assert.equal(m.scoreBreed(lost, { ...found, breed: 'Mixed breed', breed_unknown: true }), 10);
  assert.equal(m.scoreBreed(lost, { ...found, breed: 'aspin' }), 20, 'breed text is compared case-insensitively');
  assert.equal(m.scoreBreed(lost, { ...found, breed: 'Beagle' }), 0);
  assert.equal(m.scoreBreed({ ...lost, breed_unknown: true }, { ...found, breed_unknown: true }), 10);
});

test('color: primary 12 + secondary overlap up to 8', () => {
  const c = names => ({ color_names: names, primary_color: names[0] });
  const a = { ...lost, ...c(['black', 'white', 'brown']) };
  assert.equal(m.scoreColor(a, { ...found, ...c(['black', 'white', 'brown']) }), 20);
  assert.equal(m.scoreColor(a, { ...found, ...c(['black', 'white', 'gray']) }), 16);   // 12 + 8 * 1/2
  assert.equal(m.scoreColor(a, { ...found, ...c(['brown']) }), 6);                     // cross match only
  assert.equal(m.scoreColor(a, { ...found, ...c(['gray']) }), 0);
  assert.equal(m.scoreColor({ color: 'Black and White' }, { color: 'white, black' }), 6 + 8 * 0, 'plain color text works too: primaries differ, cross match');
});

test('color text and breed text helpers', () => {
  assert.deepEqual(m.splitColors('Black and White'), ['black', 'white']);
  assert.deepEqual(m.splitColors('Brown / Tan, white'), ['brown', 'tan', 'white']);
  assert.deepEqual(m.splitColors(''), []);
  assert.ok(m.isUnknownBreed('Mixed breed') && m.isUnknownBreed('') && m.isUnknownBreed(' UNKNOWN '));
  assert.ok(!m.isUnknownBreed('Shih Tzu'));
});

test('markings use keyword overlap and ignore filler words', () => {
  assert.deepEqual([...m.keywords('The white patch on his chest')].sort(), ['chest', 'patch', 'white']);
  assert.equal(m.scoreMarkings({ markings: 'white patch on chest' }, { markings: 'a WHITE chest patch' }), 20);
  assert.equal(m.scoreMarkings({ markings: 'white patch' }, { markings: 'black ear' }), 0);
  assert.equal(m.scoreMarkings({ markings: '' }, { markings: 'black ear' }), 0);
});

test('size, sex', () => {
  assert.equal(m.scoreSize({ size: 'small' }, { size: 'small' }), 10);
  assert.equal(m.scoreSize({ size: 'small' }, { size: 'medium' }), 5);
  assert.equal(m.scoreSize({ size: 'small' }, { size: 'large' }), 0);
  assert.equal(m.scoreSex({ sex: 'male' }, { sex: 'male' }), 5);
  assert.equal(m.scoreSex({ sex: 'male' }, { sex: 'unknown' }), 2);
  assert.equal(m.scoreSex({ sex: 'male' }, { sex: 'female' }), 0);
});

test('distance decays linearly to 0 at the radius edge', () => {
  assert.equal(m.scoreDistance(lost, found), 20);
  const halfKmLat = 1.5 / 111.19;                               // about 1.5 km north = half of the 3 km radius
  const half = m.scoreDistance(lost, { ...found, lat: lost.lat + halfKmLat });
  assert.ok(Math.abs(half - 10) < 0.1, `got ${half}`);
  assert.equal(m.scoreDistance(lost, { ...found, lat: lost.lat + 0.1 }), 0);
});

test('recency: full within 3 days, then decays', () => {
  const at = d => m.scoreRecency(lost, { ...found, event_date: d });
  assert.equal(at('2026-10-04'), 5);
  assert.ok(at('2026-10-09') < 5 && at('2026-10-09') > 0);
  assert.equal(at('2026-10-20'), 0);
  assert.equal(at('2026-09-30'), 5, 'found slightly before lost (buffer) still counts as full');
});

test('labels and threshold', () => {
  assert.equal(m.labelFor(80), 'Strong');
  assert.equal(m.labelFor(79.99), 'Likely');
  assert.equal(m.labelFor(65), 'Likely');
  assert.equal(m.labelFor(50), 'Possible');
  assert.equal(m.labelFor(49.9), 'Weak');
  assert.equal(m.labelFor(10), 'Weak');
  assert.equal(m.labelFor(9.99), null);
  assert.equal(m.CONFIG.threshold, 10);
  assert.equal(Object.values(m.CONFIG.weights).reduce((a, b) => a + b, 0), 100);
});