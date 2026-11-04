/* =========================================================
   Attribute matching page.

   Connected to the Express backend matches API:
     GET /api/matches/mine?report_id=<id>
     POST /api/matching/run/<id>

   - Lost report of mine  -> compared with FOUND reports.
   - Found report of mine -> compared with LOST reports.
   Cards display photo, name, key facts, match percentage and score breakdown.
   "View details" opens the pet's report with a "Why this matches" section.
   ========================================================= */

const listEl = $('#match-list');
const ms = $('#ms'), trigger = $('#ms-trigger'), panel = $('#ms-panel');
const pctEl = $('#pct-chips'), headEl = $('#match-head'), controls = $('#match-controls');

const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const KIND = { lost: 'Lost', found: 'Found' };
const CHEVRON = '<svg class="ms-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/* Bands match the status colours: green 80-100, yellow 65-79, orange 50-64, red 0-49 */
const BANDS = [
  { key: 'all', label: 'All', lo: 0, hi: 100 },
  { key: 'high', label: '80%\u2013100%', lo: 80, hi: 100 },
  { key: 'mid', label: '65%\u201379%', lo: 65, hi: 79 },
  { key: 'fair', label: '50%\u201364%', lo: 50, hi: 64 },
  { key: 'low', label: '0%\u201349%', lo: 0, hi: 49 }
];

let mine = [];              // my active reports (newest first)
let chosenId = '';          // the report being matched
let band = BANDS[0];        // which percentage band is shown (All by default)
let currentMatches = [];    // matches for chosenId from the backend

const inKind = k => mine.filter(r => r.kind === k);
const selected = () => mine.find(r => String(r.id) === String(chosenId)) || mine[0];

function matchCard(m, rank, me, top) {
  const r = m.my_role === 'finder' ? m.lost : m.found;
  if (!r) return '';
  const lost = r.kind === 'lost';
  const p = Math.round(m.score);
  const hit = m.breakdown ? matchKeysFromBreakdown(m.breakdown) : (scoreReport(me, r) ? matchKeys(scoreReport(me, r)) : []);
  const href = matchHref(r, me, m.id);
  const facts = [speciesOf(r), r.breed, r.color, r.size].filter(Boolean).map(esc).join(' &middot; ');

  return `<article class="m-card m-card--${tier(p)}${top ? ' m-card--top' : ''}">
    <a class="m-photo" href="${href}" tabindex="-1" aria-hidden="true">
      <img src="${esc(r.photo)}" alt="" loading="lazy">
      <span class="tag-missing${lost ? '' : ' tag-found'}"><span class="tag-dot" aria-hidden="true"></span>${lost ? 'Missing' : 'Found'}</span>
    </a>
    <div class="m-body">
      ${top ? `<p class="m-top-tag"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/></svg>Most compatible</p>` : ''}
      <h3>${top ? '' : `<span class="m-rank">#${rank}</span>`}<a href="${href}">${esc(titleOf(r))}</a></h3>
      <p class="m-facts">${facts}</p>
      <p class="m-meta"><span>${ICON.pin}${lost ? 'Last seen' : 'Found'} in ${esc(r.brgy)}</span><span>${ICON.calendar}${esc(ago(r.date))}</span></p>
      ${hit.length ? `<p class="m-chips" aria-label="Matching attributes">${hit.map(k => `<span class="m-chip">${STATUS_ICON.yes}${esc(LABELS[k] || k)}</span>`).join('')}</p>` : ''}
    </div>
    <div class="m-side">
      <div class="m-score" role="img" aria-label="${p} percent match">
        <div class="m-pct">${p}<small>%</small></div>
        <div class="m-verdict">${verdict(p)}</div>
        <div class="m-bar"><span style="width:${p}%"></span></div>
      </div>
      <a class="m-view" href="${href}">View details<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
    </div>
  </article>`;
}

/* The report picker: one card showing the current report. With more than one report it opens a short list
   (Lost reports, then Found reports). The newest report is chosen for you, so most people never open it. */
const thumb = r => `<img src="${esc(r.photo)}" alt="" onerror="this.remove()">`;
const sub = r => `<small><span class="ms-kind ms-kind--${r.kind}">${KIND[r.kind]}</span>${esc(r.brgy)} &middot; ${esc(ago(r.date))}</small>`;

function drawPicker() {
  const me = selected(), many = mine.length > 1;
  trigger.classList.toggle('is-static', !many);
  trigger.setAttribute('aria-haspopup', many ? 'true' : 'false');
  trigger.innerHTML = `${thumb(me)}<span class="ms-text"><b>${esc(titleOf(me))}</b>${sub(me)}</span>${many ? `<span class="ms-arrow">${CHEVRON}<span class="sr-only">Change report</span></span>` : ''}`;
  panel.innerHTML = ['lost', 'found'].filter(k => inKind(k).length).map(k => `<fieldset class="ms-group">
      <legend>${KIND[k]} reports<span>${inKind(k).length}</span></legend>
      ${inKind(k).map(r => `<label class="ms-option">
        <input type="radio" name="myreport" value="${esc(r.id)}" ${String(r.id) === String(me.id) ? 'checked' : ''}>
        ${thumb(r)}<span class="ms-text"><b>${esc(titleOf(r))}</b>${sub(r)}</span>
        <span class="ms-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>
      </label>`).join('')}
    </fieldset>`).join('');
}

const setOpen = open => {
  panel.hidden = !open; ms.classList.toggle('is-open', open); trigger.setAttribute('aria-expanded', String(open));
  if (open) (panel.querySelector('input:checked') || panel.querySelector('input'))?.focus();
};

/* Percentage chips, with live match counts */
function drawChips() {
  pctEl.innerHTML = BANDS.map(x => {
    const n = currentMatches.filter(m => Math.round(m.score) >= x.lo && Math.round(m.score) <= x.hi).length;
    return `<label class="mc-chip"><input type="radio" name="pct" value="${x.key}" ${x.key === band.key ? 'checked' : ''}><span>${x.key === 'all' ? '' : `<i class="t-${x.key}" aria-hidden="true"></i>`}${x.label}<b>${n}</b></span></label>`;
  }).join('');
}

function draw() {
  const me = selected(), want = me.kind === 'lost' ? 'found' : 'lost';
  const shown = currentMatches.filter(m => Math.round(m.score) >= band.lo && Math.round(m.score) <= band.hi);
  drawPicker();
  drawChips();

  headEl.innerHTML = `<h2>Matches for &ldquo;${esc(titleOf(me))}&rdquo;</h2>
    <p>Comparing with <b>${want}</b> reports &middot; showing ${shown.length} of ${currentMatches.length}</p>`;

  if (shown.length) {
    listEl.innerHTML = shown.map((m, i) => matchCard(m, i + 1, me, i === 0)).join('');
    return;
  }

  listEl.innerHTML = `<p class="rempty">${currentMatches.length
    ? `No ${want} reports are between ${band.lo}% and ${band.hi}%. Choose &ldquo;All&rdquo; to see every ${want} report that could match.`
    : `No matching ${want} reports of a ${esc(speciesOf(me).toLowerCase() || 'similar animal')} have been found within search radius yet.`}</p>`;
}

async function loadMatchesFor(reportId) {
  try {
    const res = await MatchesAPI.mine({ report_id: reportId, status: 'open', limit: 100 });
    let items = res.items || [];
    // If no matches are found in database yet, run matching once to find candidates
    if (items.length === 0) {
      try {
        await MatchesAPI.run(reportId);
        const refreshed = await MatchesAPI.mine({ report_id: reportId, status: 'open', limit: 100 });
        items = refreshed.items || [];
      } catch (e) {
        console.warn('Auto match run skipped:', e.message);
      }
    }
    currentMatches = items;
  } catch (err) {
    console.error('Failed to load matches:', err);
    currentMatches = [];
  }
}

async function choose(id) {
  if (!mine.some(x => String(x.id) === String(id))) return;
  chosenId = String(id);
  try { history.replaceState(null, '', 'matching.html?report=' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
  listEl.innerHTML = skeletonCards(3);
  await loadMatchesFor(chosenId);
  draw();
}

async function init() {
  listEl.innerHTML = skeletonCards(3);
  try {
    mine = await ReportsAPI.mine({ status: 'active' });
    if (!mine.length) {
      const all = await ReportsAPI.list({ kind: 'all' });
      mine = all.filter(isOwner).filter(r => r.status === 'active');
    }
  } catch (err) {
    console.error(err);
    try {
      const all = await ReportsAPI.list({ kind: 'all' });
      mine = all.filter(isOwner).filter(r => r.status === 'active');
    } catch (e) {
      listEl.innerHTML = '<p class="rempty">Could not load reports. Please try again.</p>';
      return;
    }
  }

  if (!mine.length) {
    $('#match-lead').textContent = 'File a lost or found report and we will show the reports that look most like it.';
    listEl.innerHTML = `<div class="box m-empty"><h2>No report to match yet</h2><p>Add a lost or found report and we'll show the closest matches.</p><a class="btn btn-sun" href="add-report.html">Add pet report</a></div>`;
    return;
  }
  mine.sort((a, b) => (b.created || 0) - (a.created || 0));    // newest first
  controls.hidden = false;
  $('#mr-head').hidden = false;

  trigger.addEventListener('click', () => { if (mine.length > 1) setOpen(panel.hidden); });
  panel.addEventListener('change', e => {
    if (e.target.name === 'myreport') {
      choose(e.target.value);
      setOpen(false);
      trigger.focus();
    }
  });
  document.addEventListener('click', e => { if (!panel.hidden && !ms.contains(e.target)) setOpen(false); });
  ms.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); trigger.focus(); } });
  pctEl.addEventListener('change', e => {
    if (e.target.name === 'pct') {
      band = BANDS.find(x => x.key === e.target.value) || BANDS[0];
      draw();
    }
  });

  const want = new URLSearchParams(location.search).get('report');   // matching.html?report=<id>
  const targetId = want && mine.some(r => String(r.id) === String(want)) ? want : mine[0].id;
  await choose(targetId);
}

init();
