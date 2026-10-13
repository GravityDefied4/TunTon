/* =========================================================
   Full report details page: report.html?id=<report id>
   Shows every photo, the description, where the pet was last
   seen (with a map) and how to contact the reporter.
   Data comes from ReportsAPI (js/api.js).
   ========================================================= */

const host = $('#view-detail');
const titleOf = r => r.name || [r.color, r.species].filter(Boolean).join(' ') || 'Pet';
const zoneText = m => m >= 1000 ? (m / 1000) + ' km' : m + ' m';

/* A contact that looks like an email or phone number becomes a link. */
function contactHTML(c) {
  if (!c) return '<p class="hint">The reporter did not leave contact details.</p>';
  const link = /@/.test(c) ? 'mailto:' + c : /^[+\d][\d\s()-]{6,}$/.test(c) ? 'tel:' + c.replace(/[^\d+]/g, '') : '';
  return link ? `<a class="d-contact" href="${esc(link)}">${esc(c)}</a>` : `<p class="d-contact">${esc(c)}</p>`;
}

function notFound() {
  document.title = 'Report not found | TunTon';
  host.innerHTML = `<div class="box d-empty"><h1>Report not found</h1>
    <p>This report may have been removed or marked as reunited.</p>
    <a class="btn btn-sun" href="reports.html">Back to all reports</a></div>`;
}

/* One found report on a lost report. */
const FIND_LABEL = { pending: 'Waiting for the owner', confirmed: '✓ Confirmed', rejected: 'Not a match' };
function findCard(f, n, list) {
  return `<article class="d-find d-find--${esc(f.status)}" data-fid="${esc(f.id)}">
    <header><h3>Found report ${list.length - n}${f.by === myId ? ' (yours)' : ''}</h3><span class="d-status d-status--${esc(f.status)}">${esc(FIND_LABEL[f.status] || f.status)}</span></header>
    <dl class="d-list">
      <dt>Found in</dt><dd>Barangay ${esc(f.brgy)}, Dagupan City</dd>
      <dt>Found on</dt><dd>${esc(niceDate(f.date))} (${esc(ago(f.date).toLowerCase())})</dd>
      ${f.where ? `<dt>Pet is now</dt><dd>${esc(f.where)}</dd>` : ''}
      ${f.howFound ? `<dt>How it was found</dt><dd>${esc(f.howFound)}</dd>` : ''}
      ${f.markings ? `<dt>Markings noticed</dt><dd>${esc(f.markings)}</dd>` : ''}
      <dt>Finder's contact</dt><dd>${current && (isOwner(current) || f.by === myId) ? contactHTML(f.contact) : '<span class="hint">Only the owner can see this.</span>'}</dd>
    </dl>
    ${f.photos && f.photos.length ? `<div class="d-found-photos">${f.photos.map((p, i) => `<button type="button" data-fp="${i}" aria-label="Finder's photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join('')}</div>` : ''}
    ${f.status === 'pending' && current && isOwner(current) && !confirmedFind(current) ? `<div class="d-find-actions"><button type="button" class="btn btn-sun" data-confirm="${esc(f.id)}">Confirm: this is my pet</button><button type="button" class="btn btn-small btn-plain" data-reject="${esc(f.id)}">Not my pet</button></div>` : ''}
  </article>`;
}

let current = null;   // the report being shown

function show(r) {
  current = r;
  const lost = r.kind === 'lost', home = r.status === 'reunited', isFound = reportState(r) === 'found', owner = isOwner(r), finds = findsOf(r), confirmed = confirmedFind(r), title = titleOf(r);
  /* Every logged-in user can read the found reports. The finder's contact is only shown to the owner and to that finder. */
  const visible = finds.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const mine = finds.some(f => f.by === myId && f.status === 'pending');
  const verb = lost ? 'Last seen' : 'Found';
  const pics = r.photos && r.photos.length ? r.photos : [r.photo];
  document.title = title + ' | TunTon';

  /* description text: lost = how it went missing; found = how it was found. Old reports fall back to markings. */
  const desc = lost ? (r.description || r.markings || '') : (r.howFound || r.markings || '');
  const markingsUsed = !(lost ? r.description : r.howFound);
  const facts = [
    ['Species', r.species], ['Breed', r.breed || 'Not specified'], ['Color', r.color],
    ['Size', r.size || 'Not specified'],
    markingsUsed ? null : ['Markings', r.markings]
  ].filter(x => x && x[1]);

  const place = [
    [lost ? 'Last seen in' : 'Found in', 'Barangay ' + r.brgy + ', Dagupan City'],
    [lost ? 'Last seen on' : 'Found on', niceDate(r.date) + ' (' + ago(r.date).toLowerCase() + ')'],
    lost && r.zone ? ['Search zone', 'Within ' + zoneText(r.zone) + ' of the pin'] : null,
    !lost && r.where ? ['Pet is now', r.where] : null,
    r.created ? ['Report posted', new Date(r.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })] : null
  ].filter(Boolean);

  host.innerHTML = `
  <div class="d-top">
    <div class="d-gallery">
      <div class="d-photo">
        <button type="button" class="d-photo-btn" id="d-zoom" aria-label="View photo full size"><img id="d-img" alt=""></button>
        <span class="tag-missing${lost && !isFound && !home ? '' : ' tag-found'}"><span class="tag-dot" aria-hidden="true"></span>${home ? 'Reunited' : isFound ? 'Found' : lost ? 'Missing' : 'Found'}</span>
        ${pics.length > 1 ? `<button type="button" class="d-nav d-prev" aria-label="Previous photo">&lsaquo;</button><button type="button" class="d-nav d-next" aria-label="Next photo">&rsaquo;</button><span class="d-count" id="d-count"></span>` : ''}
      </div>
      <div class="d-thumbs" id="d-thumbs">${pics.length > 1 ? pics.map((p, i) => `<button type="button" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join('') : ''}</div>
    </div>

    <aside class="box d-summary">
      <span class="badge ${home || isFound ? 'badge--home' : lost ? 'badge--lost' : ''}">${home ? '&#10003; Reunited' : isFound ? 'Pet found' : lost ? 'Lost pet' : 'Found pet'}</span>
      <h1>${esc(title)}</h1>
      <p class="d-sub">${esc([r.species, r.breed, r.color].filter(Boolean).join(' · '))}</p>
      <ul class="pet-info">
        <li><span aria-hidden="true">📍</span> ${verb} in ${esc(r.brgy)}</li>
        <li><span aria-hidden="true">🗓️</span> ${verb} ${esc(niceDate(r.date))} &middot; ${esc(ago(r.date))}</li>
        ${confirmed ? `<li><span aria-hidden="true">✅</span> Found in ${esc(confirmed.brgy)} &middot; ${esc(niceDate(confirmed.date))}</li>` : lost && finds.length ? `<li><span aria-hidden="true">🔔</span> ${finds.length} found ${finds.length === 1 ? 'report' : 'reports'} &middot; waiting for the owner</li>` : ''}
      </ul>
      <div class="d-actions">
        ${lost && !home && !isFound && !owner ? '<a class="btn btn-sun" id="d-found" href="found.html?match=' + encodeURIComponent(r.id) + '">' + (mine ? 'Update my found report' : 'I found this pet') + '</a>' : ''}
        <a class="btn btn-small" href="dashboard.html?focus=${encodeURIComponent(r.id)}">View on map</a>
      </div>
    </aside>
  </div>

  <div class="d-grid">
    <section class="box d-card d-wide">
      <h2>${lost ? 'Description' : 'How it was found'}</h2>
      <p class="d-text">${desc ? esc(desc) : 'No extra description was provided.'}</p>
    </section>

    <section class="box d-card">
      <h2>Pet details</h2>
      <dl class="d-list">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    </section>

    <section class="box d-card">
      <h2>${lost ? 'Where it was last seen' : 'Where it was found'}</h2>
      <dl class="d-list">${place.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    </section>

    <section class="box d-card d-wide">
      <h2>Location on the map${visible.length ? ' <small>(red: last seen, green: found)</small>' : ''}</h2>
      <div id="d-map" class="d-map" role="img" aria-label="Map showing where the pet was ${lost ? 'last seen' : 'found'}"></div>
      <p class="hint">Pin location is approximate. ${lost && r.zone ? 'The circle is the search zone set by the owner.' : ''}</p>
    </section>

    ${visible.length ? `<section class="box d-card d-wide d-foundbox">
      <h2>${owner && !confirmed ? 'Found reports to review' : 'Found reports'} (${visible.length})</h2>
      <p class="hint" style="margin:0 0 1rem">${owner ? (confirmed ? 'You confirmed one of these as your pet.' : 'Check each report. Confirm the one that is your pet. The report will then show as Found.') : 'People who say they found this pet. Only the owner can confirm a found report.'}</p>
      <div class="d-finds">${visible.map((f, n) => findCard(f, n, visible)).join('')}</div>
    </section>` : ''}

    <section class="box d-card d-wide d-contactbox">
      <h2>${lost ? "Owner's contact" : 'Contact'}</h2>
      <p class="hint" style="margin:0 0 .5rem">${lost ? (owner ? 'This is the contact finders will see.' : 'If you have seen this pet, please get in touch.') : 'If this is your pet, contact the finder to claim it.'}</p>
      ${contactHTML(r.contact)}
    </section>
  </div>`;

  /* ----- photo gallery ----- */
  let i = 0;
  const img = $('#d-img');
  const showPic = n => {
    i = (n + pics.length) % pics.length;
    img.src = pics[i];
    img.alt = (lost ? 'Missing ' : 'Found ') + title + (pics.length > 1 ? ` (photo ${i + 1} of ${pics.length})` : '');
    document.querySelectorAll('#d-thumbs button').forEach((b, j) => b.classList.toggle('on', j === i));
    const c = $('#d-count'); if (c) c.textContent = (i + 1) + ' / ' + pics.length;
  };
  showPic(0);
  $('#d-thumbs').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) showPic(+b.dataset.i); });
  host.querySelector('.d-prev')?.addEventListener('click', () => showPic(i - 1));
  host.querySelector('.d-next')?.addEventListener('click', () => showPic(i + 1));
  const openPreview = (src, alt) => {
    let d = $('#photo-preview');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'photo-preview'; d.className = 'dialog preview';
      d.innerHTML = '<button type="button" class="dialog-close" aria-label="Close">&times;</button><img alt="">';
      d.addEventListener('click', e => { if (e.target === d || e.target.closest('.dialog-close')) d.close(); });
      document.body.append(d);
    }
    d.querySelector('img').src = src; d.querySelector('img').alt = alt;
    d.showModal();
  };
  $('#d-zoom').addEventListener('click', () => openPreview(pics[i], img.alt));
  host.querySelectorAll('.d-find').forEach(card => card.addEventListener('click', e => {
    const f = finds.find(x => x.id === card.dataset.fid); if (!f) return;
    const ph = e.target.closest('button[data-fp]');
    if (ph) return openPreview(f.photos[+ph.dataset.fp], "Finder's photo " + (+ph.dataset.fp + 1));
    const ok = e.target.closest('button[data-confirm]'), no = e.target.closest('button[data-reject]');
    if (!ok && !no) return;
    if (ok && !confirm('Confirm that this is your pet? The report will be marked as Found and the other found reports will be closed.')) return;
    if (no && !confirm('Mark this found report as not your pet?')) return;
    const next = finds.map(x => x.id === f.id ? { ...x, status: ok ? 'confirmed' : 'rejected', reviewedAt: Date.now() }
      : ok && x.status === 'pending' ? { ...x, status: 'rejected', reviewedAt: Date.now() } : x);
    try { const { found: _old, ...rest } = r; saveReport({ ...rest, finds: next }); }
    catch { alert('Could not save (browser storage is full).'); return; }
    show({ ...r, finds: next, found: undefined });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  /* ----- map ----- */
  if (typeof L === 'undefined') { $('#d-map').textContent = 'The map library failed to load. Check your internet connection.'; return; }
  const m = L.map('d-map', { scrollWheelZoom: false }).setView([r.lat, r.lng], 16);
  tiles(m);
  L.marker([r.lat, r.lng], { icon: pinIcon(r.kind) }).addTo(m);
  if (lost && r.zone) {
    const c = L.circle([r.lat, r.lng], { radius: r.zone, color: '#d93636', weight: 2, fillOpacity: .1, interactive: false }).addTo(m);
    m.fitBounds(c.getBounds().pad(.15));
  }
  const pts = visible.filter(f => f.status !== 'rejected' && isFinite(f.lat) && isFinite(f.lng));
  pts.forEach(f => L.marker([f.lat, f.lng], { icon: pinIcon('found') }).addTo(m).bindPopup(f.status === 'confirmed' ? 'Confirmed: where it was found' : 'Where it was found'));
  if (pts.length) m.fitBounds(L.latLngBounds([[r.lat, r.lng]].concat(pts.map(f => [f.lat, f.lng]))).pad(.3));
}

(async () => {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return notFound();
  try {
    const r = await ReportsAPI.get(id);
    r ? show(r) : notFound();
  } catch (err) {
    console.error(err);
    host.innerHTML = '<p class="rempty">Could not load this report. Please try again.</p>';
  }
})();
