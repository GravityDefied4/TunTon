/* =========================================================
   Attribute matching: shared scoring (used by matching.html and report.html).

   How the percentage works
   Every attribute has a weight. Each one scores from 0 to 1 and the
   result is   (sum of weight x score) / (sum of weights that could be compared).
   An attribute that is blank on either report (or "Unknown") is skipped,
   so missing information does not lower the score unfairly.
   A different species is never a match, so those reports are left out.
   ========================================================= */

const WEIGHTS = { species: 25, color: 25, breed: 20, size: 15, markings: 10, location: 5 };
/* Labels shown to the person, in display order */
const LABELS = { species: 'Species', color: 'Color', breed: 'Breed', size: 'Size', markings: 'Markings', location: 'Location' };

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

/* ---------- One attribute at a time. Each returns { score 0..1 | null, mine, theirs } ---------- */
const COMPARE = {
  species: (a, b) => ({ score: speciesOf(a).toLowerCase() === speciesOf(b).toLowerCase() ? 1 : 0, mine: speciesOf(a), theirs: speciesOf(b) }),
  color: (a, b) => ({ score: blank(a.color) || blank(b.color) ? null : dice(colorWords(a.color), colorWords(b.color)), mine: a.color, theirs: b.color }),
  breed: (a, b) => {
    if (blank(a.breed) || blank(b.breed)) return { score: null, mine: a.breed, theirs: b.breed };
    const x = norm(a.breed), y = norm(b.breed);
    if (x === y) return { score: 1, mine: a.breed, theirs: b.breed };
    /* "Mixed breed" next to a named breed: we can't tell, so give a small partial score */
    if (/mixed|aspin|puspin|domestic/.test(x + ' ' + y) && !(/mixed|aspin|puspin|domestic/.test(x) && /mixed|aspin|puspin|domestic/.test(y))) return { score: .3, mine: a.breed, theirs: b.breed };
    return { score: dice(words(a.breed), words(b.breed)) ?? 0, mine: a.breed, theirs: b.breed };
  },
  size: (a, b) => {
    if (!a.size || !b.size) return { score: null, mine: a.size, theirs: b.size };
    const order = ['small', 'medium', 'large'], d = Math.abs(order.indexOf(a.size.toLowerCase()) - order.indexOf(b.size.toLowerCase()));
    return { score: d === 0 ? 1 : d === 1 ? .5 : 0, mine: a.size, theirs: b.size };
  },
  markings: (a, b) => {
    const x = words(a.markings), y = words(b.markings);
    return { score: dice(x, y), mine: a.markings, theirs: b.markings };
  },
  location: (a, b) => {
    if (!isFinite(a.lat) || !isFinite(b.lat)) return { score: null, mine: a.brgy, theirs: b.brgy };
    const d = km([a.lat, a.lng], [b.lat, b.lng]);
    /* same barangay or inside the lost report's search zone counts fully; it fades out by 3 km */
    const zone = (a.kind === 'lost' ? a.zone : b.zone) / 1000 || 0;
    const score = (a.brgy && a.brgy === b.brgy) || d <= zone ? 1 : Math.max(0, 1 - d / 3);
    return { score, mine: a.brgy, theirs: b.brgy, dist: d };
  }
};

/* Compare my report with one candidate. Returns null when the species differ. */
function scoreReport(mine, other) {
  const parts = {}; let earned = 0, possible = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const res = COMPARE[key](mine, other);
    parts[key] = res;
    if (res.score === null || res.score === undefined) continue;
    earned += WEIGHTS[key] * res.score; possible += WEIGHTS[key];
  }
  if (parts.species.score === 0) return null;          // a dog is never a match for a cat
  return { report: other, parts, percent: possible ? Math.round(earned / possible * 100) : 0 };
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
  const RARITY_KEYS = ['color', 'breed', 'size', 'markings'];   // species is the same for every candidate, so it cannot be rare
  const clean = v => (v && String(v).trim()) || '';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const join = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : (a[0] || '');
  const num = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const lower = k => LABELS[k].toLowerCase();
  const gapDays = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
  const zoneLabel = z => z >= 1000 ? (z / 1000) + ' km' : z + ' m';
  /* Text of 3 letters or fewer (for example "dde") tells us almost nothing, even when both reports have it */
  const thin = s => !blank(s) && String(s).replace(/[^a-z]/gi, '').length <= 3;
  const empty = (r, k) => k === 'size' ? !r.size : k === 'location' ? !isFinite(r.lat) : blank(r[k]);

  /* Every report that could match mine, best first (the same rules the Matching tab uses) */
  function candidates(me, pool) {
    const want = me.kind === 'lost' ? 'found' : 'lost';
    return (pool || [])
      .filter(r => r.kind === want && !isOwner(r) && !(want === 'lost' ? reportState(r) === 'found' : !!confirmedClaim(r)))
      .map(r => scoreReport(me, r)).filter(Boolean)
      .sort((a, b) => b.percent - a.percent || (b.report.created || 0) - (a.report.created || 0));
  }

  /* Plain-language reason for one attribute */
  function noteFor(key, res, me, other) {
    const st = status(res.score), a = clean(res.mine), b = clean(res.theirs);
    if (st === 'na') {
      const mineBlank = empty(me, key), theirsBlank = empty(other, key);
      const who = mineBlank && theirsBlank ? 'both reports' : mineBlank ? 'your report' : 'this report';
      return key === 'location' ? 'A map pin is missing on one report, so distance could not be checked.'
        : `Left blank on ${who}. It is skipped, not counted against the match.`;
    }
    if (key === 'species') return `Same species: ${a}.`;
    if (key === 'color') {
      const x = [...new Set(colorWords(me.color))], y = [...new Set(colorWords(other.color))];
      const shared = x.filter(w => y.includes(w)), onlyA = x.filter(w => !y.includes(w)), onlyB = y.filter(w => !x.includes(w));
      return [shared.length ? 'In common: ' + join(shared) + '.' : 'No color in common.',
        onlyA.length ? 'Only on yours: ' + join(onlyA) + '.' : '', onlyB.length ? 'Only on this one: ' + join(onlyB) + '.' : ''].filter(Boolean).join(' ');
    }
    if (key === 'breed') {
      const generic = GENERIC.test(a.toLowerCase()) && GENERIC.test(b.toLowerCase());
      if (st === 'yes') return generic ? 'Both are mixed or local breeds, the most common kind, so this says little on its own.' : 'Same breed.';
      if (st === 'part') return res.score <= .3 ? 'One is a named breed and the other is mixed. We cannot tell them apart from text, so it earns a small partial score.' : 'The breed names overlap a little.';
      return 'Different breeds are listed.';
    }
    if (key === 'size') {
      if (st === 'yes') return 'Same size.';
      return st === 'part' ? `One size apart (${a} and ${b}). Size is judged by eye, so small gaps are common.` : 'Two sizes apart. Unlikely to be the same pet unless one report is off.';
    }
    if (key === 'markings') {
      if (thin(me.markings) || thin(other.markings)) return 'Very short text, so even an exact match is weak evidence. Look at the photos for real markings.';
      const x = words(me.markings), y = words(other.markings), shared = [...new Set(x.filter(w => y.includes(w)))];
      if (shared.length) return 'Details in common: ' + join(shared.slice(0, 6)) + '.';
      return 'No details in common. Markings are written freehand, so also check the photos.';
    }
    /* location */
    const lost = me.kind === 'lost' ? me : other, zone = lost.zone || 0, d = res.dist;
    const sameB = me.brgy && me.brgy === other.brgy;
    const far = d < .05 ? 'Practically the same spot' : (sameB ? 'Same barangay' : 'Different barangays') + ', ' + distText(d) + ' apart';
    return far + (zone ? (d <= zone / 1000 ? ', inside the ' : ', outside the ') + zoneLabel(zone) + ' search zone' : '') + '.';
  }

  function analyse(m, me, pool) {
    const other = m.report, parts = m.parts;
    const cands = candidates(me, pool), others = cands.filter(c => c.report.id !== other.id), total = others.length + 1;
    const compared = comparedKeys(m), skipped = KEYS.filter(k => !compared.includes(k));
    const hit = matchKeys(m);
    const thinMarks = compared.includes('markings') && (thin(me.markings) || thin(other.markings));
    const earned = KEYS.reduce((s, k) => s + (parts[k].score == null ? 0 : WEIGHTS[k] * parts[k].score), 0);
    const possible = compared.reduce((s, k) => s + WEIGHTS[k], 0);

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
    const gap = gapDays(lost.date, found.date);
    const gapText = gap < 0 ? `dated ${num(-gap, 'day')} before it went missing` : gap === 0 ? 'found the same day it went missing' : `found ${num(gap, 'day')} after it went missing`;

    /* Confidence: how much of the score rests on details we can trust */
    const reliable = compared.filter(k => !(k === 'markings' && thinMarks));
    const coverage = Math.round(reliable.reduce((s, k) => s + WEIGHTS[k], 0) / TOTAL * 100);
    let lvl = coverage >= 85 ? 2 : coverage >= 60 ? 1 : 0;
    if (others.length >= 3 && commonKeys.length && commonKeys.length >= hit.filter(k => k !== 'species').length) lvl = Math.max(0, lvl - 1);
    const conf = [
      { main: 'Low', tone: 'warn' }, { main: 'Medium', tone: 'ok' }, { main: 'High', tone: 'good' }
    ][lvl];

    /* Ranking among every possible match */
    const better = others.filter(c => c.percent > m.percent).length, rank = better + 1;
    const lead = others.length ? others[0].percent : 0;
    const nextBest = others.filter(c => c.percent <= m.percent)[0];
    const gapPts = rank === 1 && nextBest ? m.percent - nextBest.percent : 0;
    const close = others.filter(c => Math.abs(c.percent - m.percent) <= 10).length;

    const tiles = [
      { label: 'Confidence', main: conf.main, tone: conf.tone,
        sub: `${reliable.length} of ${KEYS.length} attributes compared reliably, ${coverage}% of the scoring weight.` },
      others.length
        ? { label: 'Ranking', main: `#${rank} of ${total}`, tone: rank === 1 ? (gapPts >= 10 ? 'good' : 'ok') : 'warn',
            sub: rank === 1 ? (gapPts > 0 ? `${num(gapPts, 'point')} ahead of the next closest report.` : 'Tied with another report.') : `${num(lead - m.percent, 'point')} behind the top match (${lead}%).` }
        : { label: 'Ranking', main: 'Only one', tone: '', sub: 'No other reports to compare it with yet.' },
      others.length
        ? { label: 'Look-alikes', main: close === 0 ? (rank === 1 ? 'Stands out' : 'No close rivals') : `${close} similar`, tone: close === 0 ? (rank === 1 ? 'good' : '') : close === 1 ? 'ok' : 'warn',
            sub: close === 0 ? 'No other report scores within 10 points of it.' : `${num(close, 'other report')} ${close === 1 ? 'scores' : 'score'} within 10 points. Compare ${close === 1 ? 'it' : 'them'} before deciding.` }
        : { label: 'Look-alikes', main: 'None yet', tone: '', sub: 'Too few reports to judge how distinctive this is.' },
      { label: 'Where and when', main: hasD ? (d < .05 ? 'Same spot' : distText(d) + ' apart') : 'Unknown',
        tone: gap < 0 || inZone === false ? 'warn' : (inZone || sameB) ? 'good' : 'ok',
        sub: cap([inZone === true ? 'inside the ' + zoneLabel(zone) + ' search zone' : inZone === false ? 'outside the ' + zoneLabel(zone) + ' search zone' : sameB ? 'same barangay' : '', gapText].filter(Boolean).join(', ')) + '.' }
    ];

    /* Strong points and things to double-check */
    const good = [], check = [];
    const solid = hit.filter(k => !(k === 'markings' && thinMarks));
    if (solid.length) good.push(`${cap(join(solid.map(lower)))} ${solid.length > 1 ? 'agree' : 'agrees'}, worth ${solid.reduce((s, k) => s + WEIGHTS[k], 0)} of the ${possible} points that could be compared.`);
    if (rareKeys.length) good.push(`Uncommon among the other reports: ${join(rareKeys.map(lower))}. Matching on these says more than matching on common traits.`);
    if (hasD && (inZone || sameB)) good.push(d < .05 ? 'The two locations are practically the same.' : `The two locations are ${distText(d)} apart${inZone ? ', inside the search zone' : ''}.`);
    if (gap >= 0 && gap <= 14) good.push(`The dates fit: ${gapText}.`);
    if (!good.length) good.push('Nothing stands out strongly yet.');

    const hints = { color: 'Lighting in photos can change how color looks.', breed: 'Breed is often a guess, so it may still be the same pet.', size: 'Size is judged by eye, so check the photos.', markings: 'Check the photos for the real markings.', location: 'Pets can travel, so this may still be right.' };
    compared.filter(k => (status(parts[k].score) === 'part' || status(parts[k].score) === 'no') && !(k === 'location' && inZone === false)).forEach(k => {
      const a = clean(parts[k].mine), b = clean(parts[k].theirs);
      check.push(k === 'location' ? `The locations are ${hasD ? distText(d) : 'far'} apart. ${hints.location}` : `${LABELS[k]} differs: yours says \u201c${a}\u201d, this one says \u201c${b}\u201d. ${hints[k] || ''}`.trim());
    });
    if (skipped.length) check.push(`Not compared: ${join(skipped.map(lower))}. Adding these details would sharpen the match.`);
    if (thinMarks) check.push(`The markings text (\u201c${clean(thin(me.markings) ? me.markings : other.markings)}\u201d) is very short, so it is treated as weak evidence.`);
    if (commonKeys.length) check.push(`Shared by most other reports: ${join(commonKeys.map(lower))}. Matching on these says little on its own.`);
    if (gap < 0) check.push(`This report is ${gapText}. Check the dates.`);
    if (inZone === false) check.push(`The pin is outside the search zone (${distText(d)} apart). Pets do wander, but look closely.`);
    check.push('A percentage cannot confirm identity. Compare the photos and ask for a detail only the real owner would know.');

    return { tiles, good, check, rarity, earned, possible, skipped };
  }

  return { candidates, analyse, noteFor };
})();


/* ---------- Display ---------- */
const fmtPts = n => String(Math.round(n * 10) / 10);

/* One attribute: the row itself and, underneath, why it scored that way */
function attrRow(key, res, me, other, rarity) {
  const st = status(res.score), clean = v => (v && String(v).trim()) || '\u2014';
  const away = key === 'location' && res.dist > .05 ? `<small>${esc(distText(res.dist))} apart</small>` : '';
  const why = { yes: 'Same or very close', part: 'Some overlap', no: 'Does not match', na: 'Not enough information' }[st];
  const w = WEIGHTS[key], pts = res.score == null ? null : w * res.score;
  const rar = rarity && rarity[key] ? ` <span class="m-sig m-sig--${rarity[key].level}">${esc(rarity[key].text)}</span>` : '';
  return `<tr class="m-row m-row--${st}">
    <th scope="row">${LABELS[key]}</th>
    <td data-label="Your report">${esc(clean(res.mine))}</td>
    <td data-label="This report">${esc(clean(res.theirs))}${away}</td>
    <td class="m-pts" data-label="Points">${pts === null ? '<span class="m-pts-num m-pts-num--na">\u2014</span>'
      : `<span class="m-pts-num">${fmtPts(pts)}<small>/${w}</small></span><span class="m-meter" aria-hidden="true"><i style="width:${Math.round(res.score * 100)}%"></i></span>`}</td>
    <td class="m-result"><span class="m-badge m-badge--${st}" title="${why}">${STATUS_ICON[st]}${STATUS_TEXT[st]}</span></td>
  </tr>
  <tr class="m-note m-note--${st}"><td colspan="5">${esc(Insight.noteFor(key, res, me, other))}${rar}</td></tr>`;
}

/* Full breakdown: percentage, evidence tiles, attribute-by-attribute table, strong points and checks.
   `pool` is every report the person can see; it lets us rank this match against the others. */
function matchPanelHTML(m, mine, pool) {
  const p = m.percent, hit = matchKeys(m), compared = comparedKeys(m), a = Insight.analyse(m, mine, pool || []);
  const names = hit.map(k => LABELS[k].toLowerCase());
  const sentence = hit.length
    ? `Both reports agree on ${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.slice(-1) : names[0]}.`
    : 'No attribute matches closely, so this is only a weak lead.';
  const list = (items, icon) => items.map(t => `<li><span class="mi-ico" aria-hidden="true">${icon}</span><span>${esc(t)}</span></li>`).join('');
  return `<section class="box d-card d-wide m-why m-why--${tier(p)}" id="match" aria-labelledby="match-title">
    <div class="m-why-head">
      <div>
        <h2 id="match-title">Why this matches your report</h2>
        <p class="m-why-sub">Compared with your ${esc(mine.kind)} report &ldquo;${esc(mine.name || [mine.color, speciesOf(mine)].filter(Boolean).join(' ') || 'Pet')}&rdquo;. ${esc(sentence)}</p>
      </div>
      <div class="m-score" role="img" aria-label="${p} percent match">
        <div class="m-pct">${p}<small>%</small></div>
        <div class="m-verdict">${verdict(p)}</div>
        <div class="m-bar"><span style="width:${p}%"></span></div>
      </div>
    </div>

    <div class="mi-tiles" role="list">
      ${a.tiles.map(t => `<div class="mi-tile${t.tone ? ' mi-tile--' + t.tone : ''}" role="listitem"><span class="mi-label">${t.label}</span><b class="mi-main">${esc(t.main)}</b><small>${esc(t.sub)}</small></div>`).join('')}
    </div>

    <h3 class="mi-h">How the score is built <span>points earned / points available</span></h3>
    <table class="m-table">
      <caption class="sr-only">How this report compares with yours, attribute by attribute</caption>
      <thead><tr><th scope="col">Attribute</th><th scope="col">Your report</th><th scope="col">This report</th><th scope="col">Points</th><th scope="col"><span class="sr-only">Result</span></th></tr></thead>
      <tbody>${Object.keys(WEIGHTS).map(k => attrRow(k, m.parts[k], mine, m.report, a.rarity)).join('')}</tbody>
    </table>
    <p class="hint m-why-foot">Score: ${fmtPts(a.earned)} of ${a.possible} possible points = ${p}%. ${hit.length} of ${compared.length} compared attributes match.${a.skipped.length ? ' Skipped because they are blank on a report: ' + a.skipped.map(k => LABELS[k].toLowerCase()).join(', ') + '.' : ''} Species and color carry the most weight.</p>

    <div class="mi-cols">
      <div class="mi-panel mi-panel--good"><h3>What supports this match</h3><ul class="mi-list">${list(a.good, STATUS_ICON.yes)}</ul></div>
      <div class="mi-panel mi-panel--check"><h3>Worth double-checking</h3><ul class="mi-list">${list(a.check, '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>')}</ul></div>
    </div>
  </section>`;
}
