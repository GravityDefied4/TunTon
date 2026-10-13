/* Unit tests for the pure matching functions. Run: npm test  (node's built-in test runner, no extra deps). */
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../services/matching');

const lost = { type: 'lost', report_id: 1, user_id: 1, status: 'active', species_id: 1, breed_id: 1, breed_unknown: false,
  size: 'medium', sex: 'male', age_group: 'adult', markings: 'white patch on chest', event_date: '2026-10-01',
  lat: 16.0485, lng: 120.3395, search_radius_km: 3, primary_color_id: 1, color_ids: [1] };
const found = { ...lost, type: 'found', report_id: 2, user_id: 2, event_date: '2026-10-02', lat: 16.0485, lng: 120.3395, search_radius_km: null };

test('identical pet at the same spot is a Strong match (100)', () => {
  const r = m.scoreMatch(lost, { ...found, event_date: '2026-10-01' });
  assert.equal(r.score, 100);
  assert.equal(r.label, 'Strong');
});

test('hard filters', () => {
  assert.ok(m.isCandidate(lost, found));
  assert.ok(!m.isCandidate(lost, { ...found, species_id: 2 }), 'a dog never matches a cat');
  assert.ok(!m.isCandidate(lost, { ...found, status: 'resolved' }), 'both must be active');
  assert.ok(!m.isCandidate(lost, { ...found, user_id: 1 }), 'own reports never match');
  assert.ok(!m.isCandidate(lost, { ...found, lat: 16.0485 + 0.05 }), 'outside the search radius (about 5.5 km)');
  assert.ok(!m.isCandidate(lost, { ...found, event_date: '2026-09-28' }), 'found long before lost');
  assert.ok(m.isCandidate(lost, { ...found, event_date: '2026-09-29' }), 'inside the 2-day buffer');
  assert.ok(!m.isCandidate(found, lost), 'wrong order of types');
});

test('breed', () => {
  assert.equal(m.scoreBreed(lost, found), 20);
  assert.equal(m.scoreBreed(lost, { ...found, breed_id: 2, breed_unknown: true }), 10);
  assert.equal(m.scoreBreed(lost, { ...found, breed_id: 9 }), 0);
  assert.equal(m.scoreBreed({ ...lost, breed_unknown: true }, { ...found, breed_unknown: true }), 10);
});

test('color: primary 12 + secondary overlap up to 8', () => {
  const a = { ...lost, primary_color_id: 1, color_ids: [1, 2, 3] };
  assert.equal(m.scoreColor(a, { ...found, primary_color_id: 1, color_ids: [1, 2, 3] }), 20);
  assert.equal(m.scoreColor(a, { ...found, primary_color_id: 1, color_ids: [1, 2, 4] }), 16);   // 12 + 8 * 1/2
  assert.equal(m.scoreColor(a, { ...found, primary_color_id: 3, color_ids: [3] }), 6);            // cross match only
  assert.equal(m.scoreColor(a, { ...found, primary_color_id: 4, color_ids: [4] }), 0);
});

test('markings use keyword overlap and ignore filler words', () => {
  assert.deepEqual([...m.keywords('The white patch on his chest')].sort(), ['chest', 'patch', 'white']);
  assert.equal(m.scoreMarkings({ markings: 'white patch on chest' }, { markings: 'a WHITE chest patch' }), 15);
  assert.equal(m.scoreMarkings({ markings: 'white patch' }, { markings: 'black ear' }), 0);
  assert.equal(m.scoreMarkings({ markings: '' }, { markings: 'black ear' }), 0);
});

test('size, sex, age group', () => {
  assert.equal(m.scoreSize({ size: 'small' }, { size: 'small' }), 10);
  assert.equal(m.scoreSize({ size: 'small' }, { size: 'medium' }), 5);
  assert.equal(m.scoreSize({ size: 'small' }, { size: 'large' }), 0);
  assert.equal(m.scoreSex({ sex: 'male' }, { sex: 'male' }), 5);
  assert.equal(m.scoreSex({ sex: 'male' }, { sex: 'unknown' }), 2);
  assert.equal(m.scoreSex({ sex: 'male' }, { sex: 'female' }), 0);
  assert.equal(m.scoreAgeGroup({ age_group: 'adult' }, { age_group: 'senior' }), 2);
  assert.equal(m.scoreAgeGroup({ age_group: 'baby' }, { age_group: 'senior' }), 0);
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
  assert.equal(m.labelFor(49.9), null);
  assert.equal(m.CONFIG.threshold, 50);
  assert.equal(Object.values(m.CONFIG.weights).reduce((a, b) => a + b, 0), 100);
});
