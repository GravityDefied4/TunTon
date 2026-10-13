/* =========================================================
   All reports page: vertical cards and filters. "View details" opens report.html.
   Data comes from ReportsAPI (js/api.js), so this file does not
   change when the Express + MySQL backend is added.
   ========================================================= */

const grid = $('#all-list');
const toolbar = document.querySelector('#view-reports .toolbar');
let reports = [];     // result of the last ReportsAPI.list() call

const titleOf = r => r.name || [r.color, r.species].filter(Boolean).join(' ') || 'Pet';
const filters = () => ({
  kind: document.querySelector('input[name=rk]:checked').value,
  species: $('#rsp').value,
  q: $('#rq').value.trim()
});
const message = text => { grid.innerHTML = `<p class="rempty">${esc(text)}</p>`; };

function card(r) {
  const lost = r.kind === 'lost', st = reportState(r), isFound = st === 'found', verb = lost ? 'Last seen' : 'Found', title = titleOf(r);
  return `
  <article class="pet-card">
    <div class="pet-thumb">
      <img src="${esc(r.photo)}" alt="${isFound ? 'Found' : 'Missing'} ${esc(title)}" loading="lazy">
      <span class="tag-missing${isFound ? ' tag-found' : ''}"><span class="tag-dot" aria-hidden="true"></span>${isFound ? 'Found' : 'Missing'}</span>
    </div>
    <div class="pet-body">
      <h3>${esc(title)}</h3>
      <ul class="pet-info">
        <li><span aria-hidden="true">📍</span> ${verb} in ${esc(r.brgy)}</li>
        <li><span aria-hidden="true">🗓️</span> ${verb} <time datetime="${esc(r.date)}">${esc(niceDate(r.date))}</time> &middot; ${esc(ago(r.date))}</li>
        ${isFound ? `<li><span aria-hidden="true">✅</span> Found in ${esc(confirmedFind(r).brgy)} &middot; ${esc(niceDate(confirmedFind(r).date))}</li>` : lost && findsOf(r).length ? `<li><span aria-hidden="true">🔔</span> ${findsOf(r).length} found ${findsOf(r).length === 1 ? 'report' : 'reports'} &middot; waiting for the owner</li>` : ''}
      </ul>
    </div>
    <div class="pet-actions">
      <a class="btn btn-small" href="report.html?id=${encodeURIComponent(r.id)}">View details</a>
      ${lost && !isFound && !isOwner(r) ? `<a class="btn btn-sun" href="found.html?match=${encodeURIComponent(r.id)}">I found this pet</a>` : ''}
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
    reports = data;
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