/* =========================================================
   Profile page: details form, stats and "My reports".
   ========================================================= */

const myReports = () => read(REPORTS_KEY, []).filter(r => (r.owner || myId) === myId).sort((a, b) => b.created - a.created);

const pfForm = $('#profile-form');
pfForm.elements.brgy.insertAdjacentHTML('beforeend', BRGY.map(b => `<option>${b}</option>`).join(''));

function renderProfile() {
  const p = prof(), name = shownName(), mine = myReports();
  const since = read('tunton_users', {})[sess?.sub]?.created;
  $('#pf-name-big').textContent = name;
  $('#pf-email').textContent = sess?.email || 'Not logged in';
  $('#pf-since').textContent = since ? 'Member since ' + new Date(since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  const av = $('#pf-avatar');
  av.innerHTML = sess?.picture ? `<img src="${esc(sess.picture)}" alt="" referrerpolicy="no-referrer">` : esc(name[0].toUpperCase());
  pfForm.elements.dname.value = p.dname || '';
  pfForm.elements.dname.placeholder = sess?.name || 'Your name';
  pfForm.elements.phone.value = p.phone || '';
  pfForm.elements.brgy.value = p.brgy || '';
  $('#st-lost').textContent = mine.filter(r => r.kind === 'lost').length;
  $('#st-found').textContent = mine.filter(r => r.kind === 'found').length;
  $('#st-home').textContent = mine.filter(r => r.status === 'reunited').length;
  $('#rep-list').innerHTML = mine.length ? mine.map(r => `
    <li class="rep"><img src="${esc(r.photo)}" alt="">
      <div class="rep-body">
        <span class="badge ${r.status === 'reunited' ? 'badge--home' : r.kind === 'lost' ? 'badge--lost' : ''}">${r.status === 'reunited' ? '&#10003; Reunited' : r.kind === 'lost' ? 'Lost' : 'Found'}</span>
        <h3>${esc(r.name || [r.species, r.color].filter(Boolean).join(' · '))}</h3>
        <p>${esc(r.brgy)} &middot; ${esc(ago(r.date))}</p>
      </div>
      <div class="rep-actions" data-id="${esc(r.id)}">
        ${r.status === 'reunited' ? '' : '<button type="button" class="btn btn-small" data-act="map">View on map</button><button type="button" class="btn btn-small btn-plain" data-act="home">Mark reunited</button>'}
        <button type="button" class="btn btn-small btn-plain danger" data-act="del">Delete</button>
      </div></li>`).join('') : '<li class="empty">You have not filed any reports yet.</li>';
}

pfForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(pfForm);
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ dname: f.get('dname').trim(), phone: f.get('phone').trim(), brgy: f.get('brgy') })); }
  catch { $('#pf-note').textContent = 'Could not save (browser storage is full).'; return; }
  applyIdentity(); renderProfile();
  $('#pf-note').textContent = 'Profile saved.';
});

$('#rep-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.parentElement.dataset.id, all = read(REPORTS_KEY, []), r = all.find(x => x.id === id);
  if (!r) return;
  if (b.dataset.act === 'map') { location.href = 'dashboard.html?focus=' + encodeURIComponent(id); return; }
  if (b.dataset.act === 'del' && !confirm('Delete this report?')) return;
  const next = b.dataset.act === 'del' ? all.filter(x => x.id !== id) : all.map(x => x.id === id ? { ...x, status: 'reunited' } : x);
  localStorage.setItem(REPORTS_KEY, JSON.stringify(next));
  renderProfile();
});

renderProfile();
