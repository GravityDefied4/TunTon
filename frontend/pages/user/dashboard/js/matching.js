/* =========================================================
   Attribute matching page.

   - Lost report of mine  -> compared with FOUND reports.
   - Found report of mine -> compared with LOST reports.
   Cards are short on purpose: photo, name, key facts and the percentage.
   "View details" opens the pet's report with a "Why this matches" section
   (scoring lives in js/match.js).
   ========================================================= */

const listEl = $('#match-list');
const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';

function matchCard(m, rank, me, top) {
  const r = m.report, lost = r.kind === 'lost', p = m.percent, hit = matchKeys(m), href = matchHref(r, me);
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
      ${hit.length ? `<p class="m-chips" aria-label="Matching attributes">${hit.map(k => `<span class="m-chip">${STATUS_ICON.yes}${LABELS[k]}</span>`).join('')}</p>` : ''}
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

/* ---------- Page logic ---------- */
const ms = $('#ms'), trigger = $('#ms-trigger'), panel = $('#ms-panel'), pctEl = $('#pct-chips'), headEl = $('#match-head'), controls = $('#match-controls');
/* Bands match the status colours: green 80-100, yellow 60-79, orange 40-59, red 0-39 */
const BANDS = [
  { key: 'all', label: 'All', lo: 0, hi: 100 },
  { key: 'high', label: '80%\u2013100%', lo: 80, hi: 100 },
  { key: 'mid', label: '60%\u201379%', lo: 60, hi: 79 },
  { key: 'fair', label: '40%\u201359%', lo: 40, hi: 59 },
  { key: 'low', label: '0%\u201339%', lo: 0, hi: 39 }
];
let mine = [];              // my active reports (newest first)
let pool = [];              // everyone else's reports
let chosenId = '';          // the report being matched
let band = BANDS[0];        // which percentage band is shown (All by default)
const inKind = k => mine.filter(r => r.kind === k);
const selected = () => mine.find(r => r.id === chosenId) || mine[0];
const KIND = { lost: 'Lost', found: 'Found' };
const CHEVRON = '<svg class="ms-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/* Everything that could match the chosen report, best first */
function scoredFor(me) { return Insight.candidates(me, pool); }

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
        <input type="radio" name="myreport" value="${esc(r.id)}" ${r.id === me.id ? 'checked' : ''}>
        ${thumb(r)}<span class="ms-text"><b>${esc(titleOf(r))}</b>${sub(r)}</span>
        <span class="ms-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>
      </label>`).join('')}
    </fieldset>`).join('');
}

const setOpen = open => {
  panel.hidden = !open; ms.classList.toggle('is-open', open); trigger.setAttribute('aria-expanded', String(open));
  if (open) (panel.querySelector('input:checked') || panel.querySelector('input'))?.focus();
};

/* Percentage chips, with how many reports each one shows */
function drawChips(all) {
  pctEl.innerHTML = BANDS.map(x => {
    const n = all.filter(m => m.percent >= x.lo && m.percent <= x.hi).length;
    return `<label class="mc-chip"><input type="radio" name="pct" value="${x.key}" ${x.key === band.key ? 'checked' : ''}><span>${x.key === 'all' ? '' : `<i class="t-${x.key}" aria-hidden="true"></i>`}${x.label}<b>${n}</b></span></label>`;
  }).join('');
}

function draw() {
  const me = selected(), want = me.kind === 'lost' ? 'found' : 'lost';
  const all = scoredFor(me), shown = all.filter(m => m.percent >= band.lo && m.percent <= band.hi);
  drawPicker(); drawChips(all);

  headEl.innerHTML = `<h2>Matches for &ldquo;${esc(titleOf(me))}&rdquo;</h2>
    <p>Comparing with <b>${want}</b> reports &middot; showing ${shown.length} of ${all.length}</p>`;

  if (shown.length) { listEl.innerHTML = shown.map((m, i) => matchCard(m, i + 1, me, i === 0)).join(''); return; }
  listEl.innerHTML = `<p class="rempty">${all.length
    ? `No ${want} reports are between ${band.lo}% and ${band.hi}%. Choose &ldquo;All&rdquo; to see every ${want} report that could match.`
    : `No ${want} reports of a ${esc(speciesOf(me).toLowerCase() || 'similar')} have been filed yet. We will list them here as soon as they are.`}</p>`;
}

function choose(id) {
  if (!mine.some(x => x.id === id)) return;
  chosenId = id;
  try { history.replaceState(null, '', 'matching.html?report=' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
  draw();
}

async function init() {
  listEl.innerHTML = skeletonCards(3);
  try {
    pool = await ReportsAPI.list({ kind: 'all' });
    mine = pool.filter(isOwner).filter(r => r.status !== 'reunited' && !(r.kind === 'lost' && reportState(r) === 'found'));
  } catch (err) { console.error(err); listEl.innerHTML = '<p class="rempty">Could not load reports. Please try again.</p>'; return; }

  if (!mine.length) {
    $('#match-lead').textContent = 'File a lost or found report and we will show the reports that look most like it.';
    listEl.innerHTML = `<div class="box m-empty"><h2>No report to match yet</h2><p>Attribute matching needs one of your own reports. If you lost a pet, we compare it with found reports. If you found a pet, we compare it with lost reports.</p><a class="btn btn-sun" href="add-report.html">Add pet report</a></div>`;
    return;
  }
  mine.sort((a, b) => (b.created || 0) - (a.created || 0));    // newest first
  controls.hidden = false; $('#mr-head').hidden = false;

  trigger.addEventListener('click', () => { if (mine.length > 1) setOpen(panel.hidden); });
  panel.addEventListener('change', e => { if (e.target.name === 'myreport') { choose(e.target.value); setOpen(false); trigger.focus(); } });
  document.addEventListener('click', e => { if (!panel.hidden && !ms.contains(e.target)) setOpen(false); });
  ms.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); trigger.focus(); } });
  pctEl.addEventListener('change', e => { if (e.target.name === 'pct') { band = BANDS.find(x => x.key === e.target.value) || BANDS[0]; draw(); } });

  const want = new URLSearchParams(location.search).get('report');   // matching.html?report=<id>
  choose(want && mine.some(r => r.id === want) ? want : mine[0].id);
}
init();
