/* =========================================================
   Attribute matching: shared scoring (used by matching.html and report.html).

   How the percentage works
   Every attribute has a weight. Each one scores from 0 to 1 and the
   result is   (sum of weight x score) / (weights compared + half the weights that could not be compared).
   An attribute that is blank on either report (or "Unknown") is not scored, but it counts
   half against the percentage, so a report with little information cannot reach 100%.
   A different species is never a match, so those reports are left out. Species is a filter,
   not a score, so every same-species report does not start with free points.
   Reports below MIN_PERCENT are not listed.
   ========================================================= */

const WEIGHTS = { color: 30, breed: 25, size: 15, markings: 15, location: 15 };   // adds up to 100
const MIN_PERCENT = 10;        // lowest overall percentage that is still listed as a match
const MISSING_WEIGHT = .5;     // share of an unknown attribute's weight that counts against the percentage
const DEFAULT_RADIUS_KM = 5;   // search radius used when a lost report has none
/* Labels shown to the person, in display order */
const LABELS = { color: 'Color', breed: 'Breed', size: 'Size', markings: 'Markings', location: 'Location' };

/* ---------- Text helpers ---------- */
const STOP = new Set(['and', 'with', 'the', 'a', 'an', 'of', 'on', 'in', 'to', 'is', 'has', 'have', 'no', 'its', 'it', 'her', 'his', 'near', 'left', 'right']);
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
const norm = s => words(s).join(' ');
const blank = s => { const n = norm(s); return !n || n === 'unknown' || n === 'not sure' || n === 'none'; };
/* Dice coefficient on two word lists (1 = identical sets, 0 = nothing in common) */
const dice = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return null; let hit = 0; A.forEach(w => { if (B.has(w)) hit++; }); return 2 * hit / (A.size + B.size); };
/* Common colour words that mean the same thing */
const SYN = { grey: 'gray', brownish: 'brown', tan: 'brown', cream: 'white', golden: 'yellow', orange: 'ginger', ginger: 'ginger', tabby: 'tabby', black: 'black', white: 'white' };
const colorWords = s => words(s).map(w => SYN[w] || w);
const clamp01 = n => Math.min(Math.max(n, 0), 1);
const hasPin = r => isFinite(r.lat) && isFinite(r.lng) && !(r.lat === 0 && r.lng === 0);
const sameSpecies = (a, b) => speciesOf(a).trim().toLowerCase() === speciesOf(b).trim().toLowerCase();
/* Breeds: "Aspin", "Puspin", "Mixed breed" and "Domestic shorthair" all mean "no particular breed" */
const isGeneric = s => /^(mixed|mix|mixed breed|crossbreed|cross breed|mongrel|native|street|aspin|puspin|domestic|domestic (short|long|medium) ?hair)$/.test(norm(s));
const BREED_FILLER = new Set(['mix', 'mixed', 'breed', 'cross', 'crossbreed', 'dog', 'cat']);
const breedWords = s => words(s).filter(w => !BREED_FILLER.has(w));
/* Markings: ignore plurals and filler, so "white spots" and "a white spot" agree */
const stem = w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const MARK_FILLER = new Set(['some', 'small', 'big', 'little', 'part', 'like', 'also', 'around', 'there', 'for', 'are', 'was', 'pet', 'dog', 'cat', 'color', 'colour', 'body']);
const markWords = s => [...new Set(words(s).map(stem).filter(w => w.length >= 3 && !MARK_FILLER.has(w)))];
const SIZE_ORDER = ['small', 'medium', 'large', 'extra large'];
const sizeIndex = s => SIZE_ORDER.indexOf(String(s || '').toLowerCase().replace(/[_-]+/g, ' ').trim());

/* ---------- One attribute at a time. Each returns { score 0..1 | null, mine, theirs } ---------- */
const COMPARE = {
  color: (a, b) => ({ score: blank(a.color) || blank(b.color) ? null : dice(colorWords(a.color), colorWords(b.color)), mine: a.color, theirs: b.color }),
  breed: (a, b) => {
    const out = s => ({ score: s, mine: a.breed, theirs: b.breed });
    if (blank(a.breed) || blank(b.breed)) return out(null);
    if (norm(a.breed) === norm(b.breed)) return out(1);
    const ga = isGeneric(a.breed), gb = isGeneric(b.breed);
    if (ga && gb) return out(.8);          // e.g. Aspin and Mixed breed: both "no particular breed"
    if (ga || gb) return out(.3);          // one is a named breed, we can't tell: small partial score
    const x = breedWords(a.breed), y = breedWords(b.breed);
    if (x.length && x.join(' ') === y.join(' ')) return out(1);   // "Shih Tzu" and "Shih Tzu mix"
    return out(Math.min(.5, dice(x, y) ?? 0));                     // different breeds never score above half
  },
  size: (a, b) => {
    const i = sizeIndex(a.size), j = sizeIndex(b.size);
    if (i < 0 || j < 0) return { score: null, mine: a.size, theirs: b.size };
    const d = Math.abs(i - j);
    return { score: d === 0 ? 1 : d === 1 ? .5 : 0, mine: a.size, theirs: b.size };
  },
  markings: (a, b) => {
    const x = markWords(a.markings), y = markWords(b.markings);
    if (!x.length || !y.length) return { score: null, mine: a.markings, theirs: b.markings };
    const hit = x.filter(w => y.includes(w)).length;
    /* average of "how much of the shorter text is covered" and "how similar the two texts are" */
    return { score: (hit / Math.min(x.length, y.length) + 2 * hit / (x.length + y.length)) / 2, mine: a.markings, theirs: b.markings };
  },
  location: (a, b) => {
    if (!hasPin(a) || !hasPin(b)) return { score: null, mine: a.brgy, theirs: b.brgy };
    const d = km([a.lat, a.lng], [b.lat, b.lng]);
    /* full points at the same spot, fading to 0 at the edge of the lost report's search radius */
    const zone = (a.kind === 'lost' ? a.zone : b.zone) / 1000;
    let score = clamp01(1 - d / (zone > 0 ? zone : DEFAULT_RADIUS_KM));
    if (a.brgy && a.brgy === b.brgy) score = Math.max(score, .5);   // same barangay is always at least half
    return { score, mine: a.brgy, theirs: b.brgy, dist: d };
  }
};

/* Compare my report with one candidate. Returns null when the species differ. */
function scoreReport(mine, other) {
  if (!sameSpecies(mine, other)) return null;          // a dog is never a match for a cat
  const parts = {}; let earned = 0, possible = 0, missing = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const res = COMPARE[key](mine, other);
    parts[key] = res;
    if (res.score === null || res.score === undefined) { missing += WEIGHTS[key]; continue; }
    earned += WEIGHTS[key] * res.score; possible += WEIGHTS[key];
  }
  const basis = possible + missing * MISSING_WEIGHT;
  return { report: other, parts, earned, possible, missing, percent: basis ? Math.round(earned / basis * 100) : 0 };
}


/* ---------- Display helpers ---------- */
const status = s => s === null || s === undefined ? 'na' : s >= .75 ? 'yes' : s > 0 ? 'part' : 'no';
const STATUS_TEXT = { yes: 'Match', part: 'Partial', no: 'Different', na: 'No info' };
const STATUS_ICON = {
  yes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  part: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
  no: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  na: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>'
};
/* status colour: green 80+, yellow 60-79, orange 40-59, red below 40 */
const tier = p => p >= 80 ? 'high' : p >= 60 ? 'mid' : p >= 40 ? 'fair' : 'low';
const verdict = p => p >= 90 ? 'Excellent match' : p >= 75 ? 'Strong match' : p >= 60 ? 'Good match' : p >= 40 ? 'Possible match' : 'Weak match';
const matchKeys = m => Object.keys(WEIGHTS).filter(k => status(m.parts[k].score) === 'yes');
const comparedKeys = m => Object.keys(WEIGHTS).filter(k => m.parts[k].score !== null && m.parts[k].score !== undefined);

/* The page that shows the full report plus the reasons it matches */
const matchHref = (other, mine) => 'report.html?id=' + encodeURIComponent(other.id) + '&match=' + encodeURIComponent(mine.id) + '#match';

/* =========================================================
   Deeper analysis. Nothing here changes the percentage: it explains it.
   - Confidence   how much solid information the score rests on
   - Ranking      where this report stands among every possible match
   - Look-alikes  whether other reports score nearly as high
   - Rarity       is a shared trait unusual, or does everyone have it?
   - Where & when distance, search zone and the dates
   ========================================================= */
const Insight = (() => {
  const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const GENERIC = /mixed|aspin|puspin|domestic/;
  const KEYS = Object.keys(WEIGHTS);
  const RARITY_KEYS = ['color', 'breed', 'size', 'markings'];
  const clean = v => (v && String(v).trim()) || '';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const join = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : (a[0] || '');
  const num = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const lower = k => LABELS[k].toLowerCase();
  const zoneLabel = z => z >= 1000 ? (z / 1000) + ' km' : z + ' m';
  /* Text of 3 letters or fewer (for example "dde") tells us almost nothing, even when both reports have it */
  const thin = s => !blank(s) && String(s).replace(/[^a-z]/gi, '').length <= 3;
  const empty = (r, k) => k === 'size' ? sizeIndex(r.size) < 0 : k === 'location' ? !hasPin(r) : blank(r[k]);

  /* Every report that could match mine, best first (the same rules the Matching tab uses) */
  function candidates(me, pool) {
    const want = me.kind === 'lost' ? 'found' : 'lost';
    return (pool || [])
      .filter(r => r.kind === want && !isOwner(r) && !(want === 'lost' ? reportState(r) === 'found' : !!confirmedClaim(r)))
      .map(r => scoreReport(me, r)).filter(c => c && c.percent >= MIN_PERCENT)
      .sort((a, b) => b.percent - a.percent || (b.report.created || 0) - (a.report.created || 0));
  }

  function analyse(m, me, pool) {
    const other = m.report, parts = m.parts;
    const cands = candidates(me, pool), others = cands.filter(c => c.report.id !== other.id), total = others.length + 1;
    const compared = comparedKeys(m), skipped = KEYS.filter(k => !compared.includes(k));
    const hit = matchKeys(m);
    const thinMarks = compared.includes('markings') && (thin(me.markings) || thin(other.markings));
    const earned = m.earned, possible = m.possible;

    /* Rarity of each matching trait among the other candidates */
    const rarity = {};
    if (others.length >= 2) RARITY_KEYS.forEach(k => {
      if (status(parts[k].score) !== 'yes' || (k === 'markings' && thinMarks)) return;
      const n = others.filter(c => status(c.parts[k].score) === 'yes').length, share = n / others.length;
      rarity[k] = share >= .6 ? { level: 'common', text: `Common: ${n} of ${others.length} other reports share it` }
        : share <= .25 ? { level: 'rare', text: n === 0 ? 'Uncommon: no other report shares it' : `Uncommon: only ${n} of ${others.length} other reports share it` }
        : { level: 'some', text: `${n} of ${others.length} other reports share it` };
    });
    const rareKeys = RARITY_KEYS.filter(k => rarity[k]?.level === 'rare');
    const commonKeys = RARITY_KEYS.filter(k => rarity[k]?.level === 'common');

    /* Where and when */
    const lost = me.kind === 'lost' ? me : other, found = me.kind === 'lost' ? other : me;
    const d = parts.location.dist, hasD = isFinite(d), zone = lost.zone || 0;
    const inZone = hasD && zone ? d <= zone / 1000 : null;
    const sameB = !!(me.brgy && me.brgy === other.brgy);

    /* Confidence: how much of the score rests on details we can trust */
    const reliable = compared.filter(k => !(k === 'markings' && thinMarks));
    const coverage = Math.round(reliable.reduce((s, k) => s + WEIGHTS[k], 0) / TOTAL * 100);
    let lvl = coverage >= 85 ? 2 : coverage >= 60 ? 1 : 0;
    if (others.length >= 3 && commonKeys.length && commonKeys.length >= hit.length) lvl = Math.max(0, lvl - 1);
    const conf = [
      { main: 'Low', tone: 'warn' }, { main: 'Medium', tone: 'ok' }, { main: 'High', tone: 'good' }
    ][lvl];

    /* Ranking among every possible match */
    const better = others.filter(c => c.percent > m.percent).length, rank = better + 1;
    const lead = others.length ? others[0].percent : 0;
    const nextBest = others.filter(c => c.percent <= m.percent)[0];
    const gapPts = rank === 1 && nextBest ? m.percent - nextBest.percent : 0;
    const close = others.filter(c => Math.abs(c.percent - m.percent) <= 10).length;

    /* Three short stats, nothing more. Each has a plain value and one short note. */
    const confNote = ['Few details to go on', 'Some details are missing', 'Most details were compared'][lvl];
    const tiles = [
      { label: 'Confidence', main: conf.main, tone: conf.tone, sub: confNote },
      others.length
        ? { label: 'Ranking', main: `#${rank} of ${total}`, tone: rank === 1 ? 'good' : 'ok',
            sub: rank === 1 ? (gapPts > 0 ? `${num(gapPts, 'point')} ahead of the next` : 'Tied for first') : `${num(lead - m.percent, 'point')} behind #1` }
        : { label: 'Ranking', main: 'Only match', tone: '', sub: 'No other reports yet' },
      { label: 'Distance', main: hasD ? (d < .05 ? 'Same spot' : distText(d)) : 'Unknown',
        tone: inZone === false ? 'warn' : (inZone || sameB) ? 'good' : 'ok',
        sub: inZone === true ? 'Inside the search zone' : inZone === false ? 'Outside the search zone' : sameB ? 'Same barangay' : hasD ? 'Between the two pins' : 'No pin on one report' }
    ];
    return { tiles, earned, possible, skipped, thinMarks };
  }

  return { candidates, analyse };
})();


/* ---------- Display ---------- */
const fmtPts = n => String(Math.round(n * 10) / 10);

/* One attribute row: what each report says, the points it earned, and the result */
function attrRow(key, res, thin) {
  const st = status(res.score), clean = v => (v && String(v).trim()) || '\u2014';
  const hint = key === 'location' && res.dist > .05 ? `${distText(res.dist)} apart` : key === 'markings' && thin ? 'Very short, counts for little' : '';
  const why = { yes: 'Same or very close', part: 'Some overlap', no: 'Does not match', na: 'Not enough information' }[st];
  const w = WEIGHTS[key], pts = res.score == null ? null : w * res.score, pct = res.score == null ? null : Math.round(res.score * 100);
  return `<tr class="m-row m-row--${st}">
    <th scope="row">${LABELS[key]}</th>
    <td data-label="Your report">${esc(clean(res.mine))}</td>
    <td data-label="This report">${esc(clean(res.theirs))}${hint ? `<small>${esc(hint)}</small>` : ''}</td>
    <td class="m-pts" data-label="Match">${pts === null ? '<span class="m-pts-num m-pts-num--na">\u2014</span>'
      : `<span class="m-pts-num">${pct}%<small>${fmtPts(pts)}/${w} pts</small></span>`}</td>
    <td class="m-result"><span class="m-badge m-badge--${st}" title="${why}">${STATUS_ICON[st]}${STATUS_TEXT[st]}</span></td>
  </tr>`;
}

/* The details panel: the score first, three quick stats, then the attribute table.
   `pool` is every report the person can see; it lets us rank this match against the others. */
function matchPanelHTML(m, mine, pool) {
  const p = m.percent, hit = matchKeys(m), compared = comparedKeys(m), a = Insight.analyse(m, mine, pool || []);
  return `<section class="box d-card d-wide m-why m-why--${tier(p)}" id="match" aria-labelledby="match-title">
    <h2 id="match-title">${ico('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>')}Match analysis</h2>

    <div class="mw-hero">
      <div class="m-score mw-score" role="img" aria-label="${p} percent match">
        <div class="mw-gauge">
          <svg viewBox="0 0 220 118" aria-hidden="true" focusable="false">
            <path class="mw-track" d="M 20 110 A 90 90 0 0 1 200 110" pathLength="100"/>
            ${p > 0 ? `<path class="mw-fill" d="M 20 110 A 90 90 0 0 1 200 110" pathLength="100" style="stroke-dasharray:${p} 100"/>` : ''}
          </svg>
          <div class="m-pct">${p}<small>%</small></div>
        </div>
        <div class="m-verdict">${verdict(p)}</div>
      </div>
      <div class="mw-side">
        <dl class="mw-stats">
          ${a.tiles.map(t => `<div class="mw-stat${t.tone ? ' mw-stat--' + t.tone : ''}"><dt>${t.label}</dt><dd class="mw-main">${esc(t.main)}</dd><dd class="mw-note">${esc(t.sub)}</dd></div>`).join('')}
        </dl>
      </div>
    </div>


    <h3 class="mw-h">Score breakdown</h3>
    <table class="m-table">
      <caption class="sr-only">How this report compares with yours, attribute by attribute</caption>
      <thead><tr><th scope="col">Attribute</th><th scope="col">Your report</th><th scope="col">This report</th><th scope="col">Match</th><th scope="col">Result</th></tr></thead>
      <tbody>${Object.keys(WEIGHTS).map(k => attrRow(k, m.parts[k], a.thinMarks)).join('')}</tbody>
    </table>
    <p class="hint m-why-foot">${p}% overall: ${fmtPts(a.earned)} of ${a.possible} compared points &middot; ${hit.length} of ${compared.length} attributes match.${a.skipped.length ? ' Blank on a report, so not scored (counts half against the percentage): ' + a.skipped.map(k => LABELS[k].toLowerCase()).join(', ') + '.' : ''} Only reports of the same species are compared. Color and breed count the most.</p>
  </section>`;
}