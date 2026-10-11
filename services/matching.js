/* Rule-based matching (plan section 5.2). Keep these as PURE functions
   (no database calls) so they can be unit-tested with known inputs. */

/* All tunable numbers live here so the group can adjust and explain them. */
const CONFIG = {
  threshold: 50,                                   // store a match at or above this score
  labels: [{ min: 80, label: 'Strong' }, { min: 65, label: 'Likely' }, { min: 50, label: 'Possible' }],
  weights: { breed: 20, color: 20, markings: 15, size: 10, sex: 5, ageGroup: 5, distance: 20, recency: 5 },
  dateBufferDays: 2,                               // found date may be this many days before lost date
  recencyFullDays: 3                               // full recency points within this many days
};

const labelFor = score => CONFIG.labels.find(l => score >= l.min)?.label ?? null;

/* Step 1: hard filters. */
function isCandidate(lost, found) {
  // TODO: opposite type, same species, both active, found inside lost.search_radius_km,
  //       found.event_date >= lost.event_date - CONFIG.dateBufferDays
  throw new Error('not implemented');
}

/* Step 2: 0 to 100. Add one small function per attribute (scoreBreed, scoreColor, ...). */
function scoreMatch(lost, found) {
  // TODO: breed, color, markings, size, sex, age group, distance, recency
  throw new Error('not implemented');
}

module.exports = { CONFIG, labelFor, isCandidate, scoreMatch };
