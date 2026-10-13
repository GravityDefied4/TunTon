/* Rule-based matching (plan section 5.2). PURE functions: no database calls, so they can be
   unit-tested with known inputs (see tests/matching.test.js). The database side
   (candidate query, upsert) lives in services/matchRunner.js.

   A "report" here is the object from db/reportQueries.loadForMatching:
   { report_id, user_id, type, species_id, breed_id, breed_unknown, size, sex, age_group, markings,
     event_date 'YYYY-MM-DD', lat, lng, search_radius_km, status, primary_color_id, color_ids[] } */
const { distanceKm } = require('./geofence');

/* All tunable numbers live here so the group can adjust and explain them. */
const CONFIG = {
  threshold: 50,                                   // store a match at or above this score
  labels: [{ min: 80, label: 'Strong' }, { min: 65, label: 'Likely' }, { min: 50, label: 'Possible' }],
  weights: { breed: 20, color: 20, markings: 15, size: 10, sex: 5, ageGroup: 5, distance: 20, recency: 5 },
  dateBufferDays: 2,                               // found date may be this many days before lost date
  recencyFullDays: 3,                              // full recency points within this many days
  recencyZeroDays: 14,                             // recency decays linearly to 0 at this many days
  /* Judgement calls the plan left open (tune freely): */
  breedBothUnknown: 10,                            // both "unknown / mixed": no real evidence, so half points
  colorPrimary: 12,                                // plan: primary color match = 12 ...
  colorSecondaryMax: 8,                            // ... plus up to 8 from secondary-color overlap
  colorCrossMatch: 6,                              // primaries differ but one pet's primary is among the other's colors
  unknownPartial: 2                                // sex / age group: either side unknown
};

const SIZES = ['small', 'medium', 'large', 'extra_large'];
const AGES = ['baby', 'young', 'adult', 'senior'];   // 'unknown' is handled separately

const W = CONFIG.weights;
const round2 = n => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

const labelFor = score => CONFIG.labels.find(l => score >= l.min)?.label ?? null;

/* Whole days between two 'YYYY-MM-DD' strings (b - a). */
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

const km = (lost, found) => distanceKm({ lat: lost.lat, lng: lost.lng }, { lat: found.lat, lng: found.lng });

/* Step 1: hard filters. */
function isCandidate(lost, found) {
  return lost.type === 'lost' && found.type === 'found'
    && lost.species_id === found.species_id
    && lost.status === 'active' && found.status === 'active'
    && lost.user_id !== found.user_id                         // never match someone's own reports
    && km(lost, found) <= lost.search_radius_km
    && dayDiff(lost.event_date, found.event_date) >= -CONFIG.dateBufferDays;
}

/* ---- Step 2: one small function per attribute (each returns 0..its weight) ---- */

function scoreBreed(lost, found) {
  if (lost.breed_unknown && found.breed_unknown) return Math.min(CONFIG.breedBothUnknown, W.breed);
  if (lost.breed_unknown || found.breed_unknown) return W.breed / 2;
  return lost.breed_id === found.breed_id ? W.breed : 0;
}

function scoreColor(lost, found) {
  const lp = lost.primary_color_id, fp = found.primary_color_id;
  let pts = 0;
  if (lp != null && lp === fp) pts = CONFIG.colorPrimary;
  else if ((lp != null && found.color_ids.includes(lp)) || (fp != null && lost.color_ids.includes(fp))) pts = CONFIG.colorCrossMatch;
  const ls = lost.color_ids.filter(c => c !== lp), fs = found.color_ids.filter(c => c !== fp);
  if (ls.length === 0 && fs.length === 0) pts += pts > 0 ? CONFIG.colorSecondaryMax : 0;   // both single-colored: they agree
  else if (ls.length && fs.length) pts += CONFIG.colorSecondaryMax * ls.filter(c => fs.includes(c)).length / Math.max(ls.length, fs.length);
  return clamp(pts, 0, W.color);
}

const FILLER = new Set(['the', 'and', 'with', 'has', 'have', 'its', 'his', 'her', 'on', 'of', 'a', 'an', 'in', 'at', 'to', 'is', 'are', 'was', 'for',
  'there', 'some', 'small', 'big', 'little', 'part', 'like', 'also', 'near', 'around', 'pet']);

/* Lowercase, letters only, drop filler words and 1-2 letter words, strip a plural 's'. */
function keywords(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().split(/[^a-z]+/)) {
    if (w.length < 3 || FILLER.has(w)) continue;
    out.add(w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
  }
  return out;
}

/* Overlap coefficient: shared / smaller set, so a short but fully matching description scores high. */
function scoreMarkings(lost, found) {
  const a = keywords(lost.markings), b = keywords(found.markings);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return W.markings * shared / Math.min(a.size, b.size);
}

function scoreSize(lost, found) {
  const gap = Math.abs(SIZES.indexOf(lost.size) - SIZES.indexOf(found.size));
  return gap === 0 ? W.size : gap === 1 ? W.size / 2 : 0;
}

function scoreSex(lost, found) {
  if (lost.sex === 'unknown' || found.sex === 'unknown') return CONFIG.unknownPartial;
  return lost.sex === found.sex ? W.sex : 0;
}

function scoreAgeGroup(lost, found) {
  if (lost.age_group === 'unknown' || found.age_group === 'unknown') return CONFIG.unknownPartial;
  const gap = Math.abs(AGES.indexOf(lost.age_group) - AGES.indexOf(found.age_group));
  return gap === 0 ? W.ageGroup : gap === 1 ? CONFIG.unknownPartial : 0;
}

/* Linear decay: 0 km = full points, edge of the lost report's search radius = 0. */
function scoreDistance(lost, found) {
  return W.distance * clamp(1 - km(lost, found) / lost.search_radius_km, 0, 1);
}

/* Full points if found within recencyFullDays of the lost date, then linear decay to 0. */
function scoreRecency(lost, found) {
  const gap = Math.max(0, dayDiff(lost.event_date, found.event_date));
  if (gap <= CONFIG.recencyFullDays) return W.recency;
  return W.recency * clamp(1 - (gap - CONFIG.recencyFullDays) / (CONFIG.recencyZeroDays - CONFIG.recencyFullDays), 0, 1);
}

/* Step 2: 0 to 100 plus the per-attribute breakdown (shown side by side in the match details). */
function scoreMatch(lost, found) {
  const parts = {
    breed: scoreBreed(lost, found), color: scoreColor(lost, found), markings: scoreMarkings(lost, found),
    size: scoreSize(lost, found), sex: scoreSex(lost, found), ageGroup: scoreAgeGroup(lost, found),
    distance: scoreDistance(lost, found), recency: scoreRecency(lost, found)
  };
  const breakdown = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round2(v)]));
  const score = round2(clamp(Object.values(parts).reduce((a, b) => a + b, 0), 0, 100));
  return { score, label: labelFor(score), breakdown };
}

module.exports = { CONFIG, labelFor, isCandidate, scoreMatch, keywords,
  scoreBreed, scoreColor, scoreMarkings, scoreSize, scoreSex, scoreAgeGroup, scoreDistance, scoreRecency };
