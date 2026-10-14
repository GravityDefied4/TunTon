/* =========================================================
   All reports page: vertical cards and filters. "View details" opens report.html.
   Data comes from ReportsAPI (js/api.js), so this file does not
   change when the Express + MySQL backend is added.
   ========================================================= */

const grid = $('#all-list');
const toolbar = document.querySelector('#view-reports .toolbar');
let here = null;     // [lat, lng] of the person, once known (for "1.2 km away")
let reports = [];     // result of the last ReportsAPI.list() call

const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const filters = () => ({
  kind: document.querySelector('input[name=rk]:checked').value,
  species: $('#rsp').value,
  q: $('#rq').value.trim()
});

/* Who filed the report. Your own reports say "You"; if the owner can't be found at all the
   card says "Community member". */
const reporterOf = r => {
  const mine = isOwner(r), info = mine ? { name: shownName(), picture: prof().picture || sess?.picture || '' } : userInfo(r.owner);
  /* Name/picture: the owner's current profile first, then what the report itself carries
     (the API sends it), else "Community member" and the initial. */
  const real = info.name || r.ownerName || '';
  return { name: mine ? 'You' : (real || 'Community member'), picture: info.picture || r.ownerPicture || '', initial: (real || '?').trim()[0].toUpperCase() };
};
/* Every card footer has the same two slots: [View details] [action OR status].
   The right slot is the main action when there is one. When there is none, it holds a
   quiet status label, so a card never ends up with a different footer layout. */
const footerAction = (r, lost, isFound, mine) =>
  isFound ? `<span class="pet-status pet-status--found">${ICON.check}Pet found</span>`
  : !lost && confirmedClaim(r) ? `<span class="pet-status pet-status--found">${ICON.check}Owner found</span>`
  : mine ? '<span class="pet-status">Your report</span>'
  : respondButton(r);
const message = text => { grid.innerHTML = `<p class="rempty">${esc(text)}</p>`; };

function card(r) {
  const lost = r.kind === 'lost', st = reportState(r), isFound = lost && st === 'found', labelFound = !lost || isFound, verb = lost ? 'Last seen' : 'Found', title = titleOf(r), who = reporterOf(r);
  return `
  <article class="pet-card">
    <div class="pet-thumb">
      <img src="${esc(r.photo)}" alt="${labelFound ? 'Found' : 'Missing'} ${esc(title)}" loading="lazy">
      <span class="tag-missing${labelFound ? ' tag-found' : ''}"><span class="tag-dot" aria-hidden="true"></span>${labelFound ? 'Found' : 'Missing'}</span>
    </div>
    <div class="pet-body">
      <h3>${esc(title)}</h3>
      <ul class="pet-info">
        <li>${ICON.pin}<span>${verb} in ${esc(r.brgy)}${here ? ' &middot; ' + esc(awayText(here, r)) : ''}</span></li>
        <li>${ICON.calendar}<span>${verb} <time datetime="${esc(r.date)}">${esc(niceDate(r.date))}</time> &middot; ${esc(ago(r.date))}</span></li>
        ${isFound ? `<li>${ICON.check}<span>Found in ${esc(confirmedFind(r).brgy)} &middot; ${esc(niceDate(confirmedFind(r).date))}</span></li>` : lost && findsOf(r).length ? `<li>${ICON.bell}<span>${findsOf(r).length} found ${findsOf(r).length === 1 ? 'report' : 'reports'} &middot; waiting for the owner</span></li>` : !lost && confirmedClaim(r) ? `<li>${ICON.check}<span>Owner confirmed</span></li>` : !lost && claimsOf(r).length ? `<li>${ICON.bell}<span>${claimsOf(r).length} lost ${claimsOf(r).length === 1 ? 'report' : 'reports'} &middot; waiting for the finder</span></li>` : ''}
      </ul>
      <p class="pet-by"><span class="pet-by-av" aria-hidden="true">${esc(who.initial)}${who.picture ? `<img src="${esc(who.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span><span class="pet-by-text">Posted by <b>${esc(who.name)}</b></span></p>
    </div>
    <div class="pet-actions">
      <a class="btn btn-plain" href="report.html?id=${encodeURIComponent(r.id)}">View details</a>
      ${footerAction(r, lost, isFound, isOwner(r))}
    </div>
  </article>`;
}

function draw() {
  $('#rcount').textContent = reports.length + (reports.length === 1 ? ' report' : ' reports');
  if (reports.length) grid.innerHTML = reports.map(card).join('');
  else message('No reports match your filters.');
}

let ticket = 0;   // ignore slow responses that were overtaken by a newer request
async function load() {
  const mine = ++ticket;
  message('Loading reports…');
  try {
    const data = await ReportsAPI.list(filters());
    if (mine !== ticket) return;
    reports = data.slice().sort((a, b) => isOwner(b) - isOwner(a));   // your own reports first
    draw();
  } catch (err) {
    if (mine !== ticket) return;
    console.error(err);
    $('#rcount').textContent = '';
    message('Could not load reports. Please try again.');
  }
}

/* ---------- Filters ---------- */
let timer;
toolbar.addEventListener('change', load);
toolbar.addEventListener('input', e => {
  if (e.target.id !== 'rq') return;          // search box: wait until typing pauses
  clearTimeout(timer); timer = setTimeout(load, 250);
});

load();

/* Distance from the person: shown once their location is known (nothing is shown if they block it) */
whereAmI().then(h => { here = h; if (h && reports.length) draw(); });
