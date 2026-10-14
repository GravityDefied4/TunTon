/* =========================================================
   All reports page: vertical cards and filters. "View details" opens report.html.
   Data comes from ReportsAPI (js/api.js), so this file does not
   change when the Express + MySQL backend is added.
   ========================================================= */

const grid = $('#all-list');
const toolbar = document.querySelector('#view-reports .toolbar');
let reports = [];     // result of the last ReportsAPI.list() call

const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const filters = () => ({
  kind: document.querySelector('input[name=rk]:checked').value,
  species: $('#rsp').value,
  q: $('#rq').value.trim()
});
/* Small line icons used instead of emoji (decorative, so hidden from screen readers). */
const ico = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  pin: ico('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  calendar: ico('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  check: ico('<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'),
  bell: ico('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>')
};

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
  : mine ? '<span class="pet-status">Your report</span>'
  : lost ? `<a class="btn btn-sun" href="found.html?match=${encodeURIComponent(r.id)}">I found this pet</a>`
  : `<a class="btn btn-sun" href="lost.html?claim=${encodeURIComponent(r.id)}">This is my lost pet</a>`;
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
        <li>${ICON.pin}<span>${verb} in ${esc(r.brgy)}</span></li>
        <li>${ICON.calendar}<span>${verb} <time datetime="${esc(r.date)}">${esc(niceDate(r.date))}</time> &middot; ${esc(ago(r.date))}</span></li>
        ${isFound ? `<li>${ICON.check}<span>Found in ${esc(confirmedFind(r).brgy)} &middot; ${esc(niceDate(confirmedFind(r).date))}</span></li>` : lost && findsOf(r).length ? `<li>${ICON.bell}<span>${findsOf(r).length} found ${findsOf(r).length === 1 ? 'report' : 'reports'} &middot; waiting for the owner</span></li>` : ''}
      </ul>
      <p class="pet-by"><span class="pet-by-av" aria-hidden="true">${esc(who.initial)}${who.picture ? `<img src="${esc(who.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span><span class="pet-by-text">Reported by <b>${esc(who.name)}</b></span></p>
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