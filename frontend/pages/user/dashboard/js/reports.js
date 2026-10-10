/* =========================================================
   All reports page: vertical cards, filters, details dialog.
   Data comes from ReportsAPI (js/api.js), so this file does not
   change when the Express + MySQL backend is added.
   ========================================================= */

const grid = $('#all-list');
const toolbar = document.querySelector('#view-reports .toolbar');
const dlg = $('#detail-dialog');
let reports = [];     // result of the last ReportsAPI.list() call
let current = null;   // report shown in the details dialog

const titleOf = r => r.name || [r.color, r.species].filter(Boolean).join(' ') || 'Pet';
const filters = () => ({
  kind: document.querySelector('input[name=rk]:checked').value,
  species: $('#rsp').value,
  q: $('#rq').value.trim()
});
const message = text => { grid.innerHTML = `<p class="rempty">${esc(text)}</p>`; };

function card(r) {
  const lost = r.kind === 'lost', verb = lost ? 'Last seen' : 'Found', title = titleOf(r);
  return `
  <article class="pet-card">
    <div class="pet-thumb">
      <img src="${esc(r.photo)}" alt="${lost ? 'Missing' : 'Found'} ${esc(title)}" loading="lazy">
      <span class="tag-missing${lost ? '' : ' tag-found'}"><span class="tag-dot" aria-hidden="true"></span>${lost ? 'Missing' : 'Found'}</span>
    </div>
    <div class="pet-body">
      <h3>${esc(title)}</h3>
      <ul class="pet-info">
        <li><span aria-hidden="true">📍</span> ${verb} in ${esc(r.brgy)}</li>
        <li><span aria-hidden="true">🗓️</span> ${verb} <time datetime="${esc(r.date)}">${esc(niceDate(r.date))}</time> &middot; ${esc(ago(r.date))}</li>
      </ul>
    </div>
    <div class="pet-actions">
      <button type="button" class="btn btn-small" data-id="${esc(r.id)}">View details</button>
      ${lost ? `<a class="btn btn-sun" href="found.html?match=${encodeURIComponent(r.id)}">I found this pet</a>` : ''}
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

/* ---------- Details dialog ---------- */
function openDetails(r) {
  current = r;
  const lost = r.kind === 'lost', title = titleOf(r);
  const pics = r.photos && r.photos.length ? r.photos : [r.photo];
  const showPic = i => {
    $('#d-img').src = pics[i];
    document.querySelectorAll('#d-thumbs button').forEach((b, j) => b.classList.toggle('on', j === i));
  };
  $('#d-thumbs').innerHTML = pics.length > 1
    ? pics.map((p, i) => `<button type="button" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join('') : '';
  $('#d-thumbs').onclick = e => { const b = e.target.closest('button[data-i]'); if (b) showPic(+b.dataset.i); };
  showPic(0);
  $('#d-img').alt = (lost ? 'Missing ' : 'Found ') + title;
  $('#d-tag').classList.toggle('tag-found', !lost);
  $('#d-tagtxt').textContent = lost ? 'Missing' : 'Found';
  $('#d-title').textContent = title;
  const rows = [
    ['Status', lost ? 'Missing' : 'Potentially found'], ['Species', r.species], ['Breed', r.breed], ['Color', r.color],
    ['Size', r.size], ['Markings', r.markings], ['Barangay', r.brgy],
    [lost ? 'Last seen' : 'Found on', niceDate(r.date) + ' · ' + ago(r.date)], ['Contact', r.contact]
  ].filter(x => x[1]);
  $('#d-list').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#d-found').hidden = !lost;
  dlg.showModal();
}

$('#d-close').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
$('#d-map').addEventListener('click', () => { location.href = 'dashboard.html?focus=' + encodeURIComponent(current.id); });
$('#d-found').addEventListener('click', () => { location.href = 'found.html?match=' + encodeURIComponent(current.id); });

grid.addEventListener('click', e => {
  const b = e.target.closest('button[data-id]'); if (!b) return;
  const r = reports.find(x => x.id === b.dataset.id);
  if (r) openDetails(r);
});

/* ---------- Filters ---------- */
let timer;
toolbar.addEventListener('change', load);
toolbar.addEventListener('input', e => {
  if (e.target.id !== 'rq') return;          // search box: wait until typing pauses
  clearTimeout(timer); timer = setTimeout(load, 250);
});

load();