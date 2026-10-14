/* =========================================================
   Full report details page: report.html?id=<report id>
   Shows every photo, the description, where the pet was last
   seen (with a map) and how to contact the reporter.
   Data comes from ReportsAPI (js/api.js).
   ========================================================= */

const host = $('#view-detail');
const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const zoneText = m => m >= 1000 ? (m / 1000) + ' km' : m + ' m';

/* Contact details are shown as plain text (no tel:/mailto: links, because this is a PWA). */
function contactHTML(c, fb) {
  if (!c && !fb) return '<p class="hint">The reporter did not leave contact details.</p>';
  const { phone, email, other } = splitContact(c);
  return [phone && ICON.phone + esc(phone), email && ICON.mail + esc(email), other && esc(other), fb && ICON.facebook + facebookHTML(fb)].filter(Boolean).map(x => `<span class="d-contact">${x}</span>`).join('');
}

function notFound() {
  document.title = 'Report not found | TunTon';
  host.innerHTML = `<div class="box d-empty"><h1>Report not found</h1>
    <p>This report may have been removed or marked as reunited.</p>
    <a class="btn btn-sun" href="reports.html">Back to all reports</a></div>`;
}

/* One response card. On a LOST report the cards are "found reports" from finders;
   on a FOUND report they are "lost reports" (claims) from people who say it is their pet. */
const RESP_LABEL = {
  find:  { pending: 'Waiting for the owner', confirmed: 'Confirmed', rejected: 'Not a match' },
  claim: { pending: 'Waiting for the finder', confirmed: 'Confirmed', rejected: 'Not a match' }
};
const confirmedOf = r => r.kind === 'lost' ? confirmedFind(r) : confirmedClaim(r);

function responseCard(f, kind) {
  const claim = kind === 'claim', role = claim ? 'Owner' : 'Finder';
  const info = userInfo(f.by);
  const person = (claim ? f.ownerName : f.founderName) || f.reporterName || info.name || (f.by === myId ? shownName() : 'Community member');
  const picture = f.finderPicture || f.ownerPicture || info.picture || '';
  const posted = f.at ? new Date(f.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const canSee = current && (isOwner(current) || f.by === myId);
  const photos = f.photos || [];
  const fact = (icon, label, val, sub) => `<li>${icon}<div><span class="d-label">${label}</span><strong>${esc(val)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div></li>`;
  const note = (label, val) => `<div class="d-find-note"><span class="d-label">${label}</span><p>${esc(val)}</p></div>`;

  /* Public: name, photo, where/when, and the pet's details.
     Private (the report's owner + the person who sent this only): phone, email and Facebook.
     Everyone else sees WHICH contact methods were left, with a lock, but never the values. */
  const { phone, email, other } = splitContact(f.contact);
  const fbLeft = !!(f.facebook && String(f.facebook).trim());
  const methods = [phone && ['phone', 'Phone number'], email && ['mail', 'Email'], other && ['info', 'Other contact'], fbLeft && ['facebook', 'Facebook']].filter(Boolean);
  const contact = canSee
    ? `<div class="d-find-contact">
        <span class="d-label">${ICON.user}${role}'s contact</span>
        <div class="d-find-chips">${contactHTML(f.contact, f.facebook)}</div>
      </div>`
    : `<div class="d-find-contact d-find-contact--locked">
        <span class="d-find-lock" aria-hidden="true">${ICON.lock}</span>
        <div>
          <span class="d-label">${role}'s contact is private</span>
          <p>${methods.length ? `Only the ${claim ? 'finder' : 'owner'} can see how to reach the ${role.toLowerCase()}.` : 'Only the ' + (claim ? 'finder' : 'owner') + ' can see this.'}</p>
          ${methods.length ? `<div class="d-find-chips">${methods.map(([k, t]) => `<span class="d-contact d-contact--locked">${ICON[k]}${t}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;

  const facts = claim
    ? [fact(ICON.pin, 'Last seen in', 'Barangay ' + f.brgy), fact(ICON.calendar, 'Last seen on', niceDate(f.date), ago(f.date)), f.zone ? fact(ICON.map, 'Search zone', 'Within ' + zoneText(f.zone)) : '']
    : [fact(ICON.pin, 'Found in', 'Barangay ' + f.brgy), fact(ICON.calendar, 'Found on', niceDate(f.date), ago(f.date)), f.where ? fact(ICON.paw, 'Pet is now', f.where) : ''];

  const petTags = claim ? [f.name, speciesOf(f), f.breed, f.color, f.size].filter(Boolean) : [];
  const notes = claim
    ? [f.description && note('Description', f.description), f.markings && note('Markings', f.markings)]
    : [f.howFound && note('How it was found', f.howFound), f.markings && note('Markings noticed', f.markings)];
  const hasNotes = notes.some(Boolean);
  const mayReview = f.status === 'pending' && current && isOwner(current) && !confirmedOf(current);

  return `<article class="d-find d-find--${esc(f.status)}" data-fid="${esc(f.id)}">
    <header class="d-find-head">
      <span class="cc-avatar d-find-avatar" aria-hidden="true">${esc(person[0].toUpperCase())}${picture ? `<img src="${esc(picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>
      <div class="d-find-who">
        <h3>${esc(person)}</h3>
        <p>${role}${posted ? ' &middot; Posted ' + esc(posted) : ''}${f.by === myId ? ' &middot; <b>Your report</b>' : ''}</p>
      </div>
      <span class="d-status d-status--${esc(f.status)}">${f.status === 'confirmed' ? ICON.check : f.status === 'pending' ? ICON.bell : ''}${esc(RESP_LABEL[kind][f.status] || f.status)}</span>
    </header>

    <div class="d-find-body${photos.length ? '' : ' d-find-body--nophoto'}">
      ${photos.length ? `<div class="d-find-photos">
        <button type="button" class="d-find-main" data-fp="0" aria-label="Open photo 1"><img src="${esc(photos[0])}" alt="Photo of the pet from the ${role.toLowerCase()}"></button>
        ${photos.length > 1 ? `<div class="d-find-thumbs">${photos.slice(1).map((p, i) => `<button type="button" data-fp="${i + 1}" aria-label="Open photo ${i + 2}"><img src="${esc(p)}" alt=""></button>`).join('')}</div>` : ''}
      </div>` : ''}

      <div class="d-find-info">
        <ul class="d-find-facts">${facts.join('')}</ul>

        ${petTags.length ? `<div class="d-find-pet">
          <span class="d-label">${ICON.paw}Their pet</span>
          <div class="d-find-tags">${petTags.map(t => `<span>${esc(t)}</span>`).join('')}</div>
        </div>` : ''}

        ${hasNotes ? `<div class="d-find-notes">${notes.filter(Boolean).join('')}</div>` : ''}

        ${contact}
      </div>
    </div>

    ${mayReview ? `<div class="d-find-actions"><button type="button" class="btn btn-sun" data-confirm="${esc(f.id)}">${claim ? 'Confirm: this is the owner' : 'Confirm: this is my pet'}</button><button type="button" class="btn btn-small btn-plain" data-reject="${esc(f.id)}">${claim ? 'Not the owner' : 'Not my pet'}</button></div>` : ''}
  </article>`;
}

let current = null;   // the report being shown

function show(r) {
  current = r;
  const lost = r.kind === 'lost', home = r.status === 'reunited', isFound = reportState(r) === 'found', owner = isOwner(r), finds = lost ? findsOf(r) : claimsOf(r), confirmed = confirmedOf(r), title = titleOf(r), kind = lost ? 'find' : 'claim', key = lost ? 'finds' : 'claims';
  /* Every logged-in user can read the responses (found reports on a lost report, lost reports on a found report).
     Contact details are only shown to the report's owner and to the person who sent the response. */
  const visible = finds.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const mine = finds.some(f => f.by === myId && f.status === 'pending');
  const verb = lost ? 'Last seen' : 'Found';
  const pics = r.photos && r.photos.length ? r.photos : [r.photo];
  document.title = title + ' | TunTon';

  /* description text: lost = how it went missing; found = how it was found. Old reports fall back to markings. */
  const desc = lost ? (r.description || r.markings || '') : (r.howFound || r.markings || '');
  const markingsUsed = !(lost ? r.description : r.howFound);
  const facts = [
    ['Species', speciesOf(r)], ['Breed', r.breed || 'Not specified'], ['Color', r.color],
    ['Size', r.size || 'Not specified'],
    markingsUsed ? null : ['Markings', r.markings]
  ].filter(x => x && x[1]);

  const place = [
    [lost ? 'Last seen in' : 'Found in', 'Barangay ' + r.brgy + ', Dagupan City'],
    [lost ? 'Last seen on' : 'Found on', niceDate(r.date) + ' (' + ago(r.date).toLowerCase() + ')'],
    lost && r.zone ? ['Search zone', 'Within ' + zoneText(r.zone) + ' of the pin'] : null,
    !lost && r.where ? ['Pet is now', r.where] : null
  ].filter(Boolean);

  const pendingFinds = finds.some(f => f.status === 'pending') && !confirmed;
  const respName = lost ? 'Found reports' : 'Lost reports';
  const respHint = owner
    ? (confirmed ? (lost ? 'You confirmed one of these as your pet.' : 'You confirmed one of these as the owner.')
      : lost ? 'Check each report. Confirm the one that is your pet. The report will then show as Found.'
      : 'Check each report. Confirm the one that belongs to the owner. The report will then show as Owner found.')
    : (lost ? 'People who say they found this pet. Only the owner can confirm a found report.' : 'People who say this is their lost pet. Only the finder can confirm a lost report.');
  const foundBox = visible.length ? `<section class="box d-card d-wide d-foundbox">
      <h2>${ICON.bell}${owner && !confirmed ? respName + ' to review' : respName} (${visible.length})</h2>
      <p class="hint" style="margin:0 0 1rem">${respHint}</p>
      <div class="d-finds">${visible.map(f => responseCard(f, kind)).join('')}</div>
    </section>` : '';

  host.innerHTML = `
  <div class="d-top">
    <div class="d-gallery">
      <div class="d-photo">
        <button type="button" class="d-photo-btn" id="d-zoom" aria-label="View photo full size"><img id="d-img" alt=""></button>
        <span class="tag-missing${lost && !isFound && !home ? '' : ' tag-found'}"><span class="tag-dot" aria-hidden="true"></span>${home ? 'Reunited' : !lost && confirmed ? 'Owner found' : isFound ? 'Found' : lost ? 'Missing' : 'Found'}</span>
        ${pics.length > 1 ? `<button type="button" class="d-nav d-prev" aria-label="Previous photo">&lsaquo;</button><button type="button" class="d-nav d-next" aria-label="Next photo">&rsaquo;</button><span class="d-count" id="d-count"></span>` : ''}
      </div>
      <div class="d-thumbs" id="d-thumbs">${pics.length > 1 ? pics.map((p, i) => `<button type="button" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join('') : ''}</div>
    </div>

    <aside class="box d-summary">
      <div class="d-sumhead">
        <span class="badge ${home || isFound || (!lost && confirmed) ? 'badge--home' : lost ? 'badge--lost' : ''}">${home ? ICON.check + 'Reunited' : !lost && confirmed ? ICON.check + 'Owner found' : isFound ? 'Pet found' : lost ? 'Lost pet' : 'Found pet'}</span>
        ${owner ? `<div class="d-options">
          <button type="button" class="d-options-btn" id="d-options-btn" aria-label="Report options" aria-haspopup="menu" aria-expanded="false">${ICON.more}</button>
          <div class="d-menu" id="d-menu" role="menu" hidden>
            <a role="menuitem" href="${lost ? 'lost' : 'found'}.html?edit=${encodeURIComponent(r.id)}">${ICON.edit}Edit report</a>
            <button type="button" role="menuitem" class="d-menu-danger" id="d-delete-report">${ICON.trash}Remove report</button>
          </div>
        </div>` : ''}
      </div>
      <h1>${esc(title)}</h1>
      <p class="d-sub">${esc([speciesOf(r), r.breed, r.color].filter(Boolean).join(' · '))}</p>
      ${contactCardHTML(r, lost ? 'Owner' : 'Finder')}
      <ul class="pet-info">
        <li>${ICON.calendar}<span>${verb} ${esc(niceDate(r.date))} &middot; ${esc(ago(r.date))}</span></li>
        ${confirmed ? `<li>${ICON.check}<span>${lost ? 'Found in ' + esc(confirmed.brgy) + ' &middot; ' + esc(niceDate(confirmed.date)) : 'Owner confirmed &middot; last seen in ' + esc(confirmed.brgy)}</span></li>` : finds.length ? `<li>${ICON.bell}<span>${finds.length} ${lost ? 'found' : 'lost'} ${finds.length === 1 ? 'report' : 'reports'} &middot; waiting for the ${lost ? 'owner' : 'finder'}</span></li>` : ''}
      </ul>
      ${(() => {
        const canFind = lost && !home && !isFound && !owner, canClaim = !lost && !home && !confirmed && !owner;
        const mapHref = 'dashboard.html?focus=' + encodeURIComponent(r.id);
        return `<div class="d-actions">
        ${canFind ? respondButton(r, 'id="d-found"') : ''}
        ${canClaim ? respondButton(r, 'id="d-claim"') : ''}
        ${canFind || canClaim ? `<a class="d-mapbtn" href="${mapHref}" title="View on map" aria-label="View on map">${ICON.map}</a>` : `<a class="btn btn-small d-mapbtn--wide" href="${mapHref}">${ICON.map}View on map</a>`}
      </div>`;
      })()}
    </aside>
  </div>

  <!-- Sections run from most to least important -->
  <div class="d-grid">
    ${owner && pendingFinds ? foundBox : ''}

    <section class="box d-card d-wide d-split">
      <div class="d-split-text">
        <h2>${ICON.pin}${lost ? 'Where it was last seen' : 'Where it was found'}</h2>
        <dl class="d-list">${place.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <p class="hint">Pin location is approximate.${lost && r.zone ? ' The circle is the search zone set by the owner.' : ''}${visible.length ? (lost ? ' Red pin: last seen. Green pin: found.' : ' Green pin: found. Red pin: where an owner says it was last seen.') : ''}</p>
      </div>
      <div id="d-map" class="d-map" role="img" aria-label="Map showing where the pet was ${lost ? 'last seen' : 'found'}"></div>
    </section>

    <section class="box d-card d-wide d-split">
      <div class="d-split-text">
        <h2>${ICON.paw}About this pet</h2>
        <dl class="d-list">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </div>
      <div class="d-about-text">
        <h3>${lost ? 'Description' : 'How it was found'}</h3>
        <p class="d-text">${desc ? esc(desc) : 'No extra description was provided.'}</p>
      </div>
    </section>

    ${!(owner && pendingFinds) ? foundBox : ''}
  </div>`;

  /* Distance from the person's current location (added once the location is known) */
  whereAmI().then(h => {
    const list = host.querySelector('.d-summary .pet-info'), text = h && awayText(h, r);
    if (!list || !text || list.querySelector('.d-away')) return;
    list.insertAdjacentHTML('afterbegin', `<li class="d-away">${ICON.pin}<span>${esc(text)} from you</span></li>`);
  });

  /* Owner options menu (edit / remove) */
  const optBtn = host.querySelector('#d-options-btn'), optMenu = host.querySelector('#d-menu');
  if (optBtn) {
    const setMenu = open => { optMenu.hidden = !open; optBtn.setAttribute('aria-expanded', open); };
    optBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(optMenu.hidden); });
    document.addEventListener('click', e => { if (!e.target.closest('.d-options')) setMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
    optMenu.addEventListener('click', () => setMenu(false));
  }

  /* Owner-only report removal, with a themed confirmation dialog. */
  if (owner) {
    host.querySelector('#d-delete-report')?.addEventListener('click', () => {
      let dialog = document.getElementById('d-delete-dialog');
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'd-delete-dialog';
        dialog.className = 'd-delete-dialog';
        dialog.innerHTML = `<div class="d-delete-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 10v6M14 10v6"/></svg></div><h2>Remove this report?</h2><p>This report will be permanently removed. This action cannot be undone.</p><div class="d-delete-actions"><button type="button" class="d-delete-cancel">Cancel</button><button type="button" class="d-delete-confirm">Remove report</button></div>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', ev => {
          if (ev.target === dialog || ev.target.closest('.d-delete-cancel')) { dialog.close(); return; }
          if (!ev.target.closest('.d-delete-confirm')) return;
          const all = read(REPORTS_KEY, []);
          localStorage.setItem(REPORTS_KEY, JSON.stringify(all.filter(x => !(x.id === current?.id && x.owner === myId))));
          dialog.close();
          location.href = 'profile.html';
        });
      }
      dialog.showModal();
    });
  }

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
    if (ph) return openPreview(f.photos[+ph.dataset.fp], 'Photo ' + (+ph.dataset.fp + 1));
    const ok = e.target.closest('button[data-confirm]'), no = e.target.closest('button[data-reject]');
    if (!ok && !no) return;
    if (ok && !confirm(lost ? 'Confirm that this is your pet? The report will be marked as Found and the other found reports will be closed.' : 'Confirm that this person is the owner of this pet? The report will be marked as Owner found and the other lost reports will be closed.')) return;
    if (no && !confirm(lost ? 'Mark this found report as not your pet?' : 'Mark this lost report as not the owner?')) return;
    const next = finds.map(x => x.id === f.id ? { ...x, status: ok ? 'confirmed' : 'rejected', reviewedAt: Date.now() }
      : ok && x.status === 'pending' ? { ...x, status: 'rejected', reviewedAt: Date.now() } : x);
    try { const { found: _old, ...rest } = r; saveReport({ ...rest, [key]: next }); }
    catch { alert('Could not save (browser storage is full).'); return; }
    show({ ...r, [key]: next, found: undefined });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  /* ----- map ----- */
  if (typeof L === 'undefined') { $('#d-map').textContent = 'The map library failed to load. Check your internet connection.'; return; }
  const m = L.map('d-map', { scrollWheelZoom: false }).setView([r.lat, r.lng], 16);
  tiles(m);
  lockToDagupan(m);
  L.marker([r.lat, r.lng], { icon: pinIcon(r.kind) }).addTo(m);
  if (lost && r.zone) {
    const c = L.circle([r.lat, r.lng], { radius: r.zone, color: '#d93636', weight: 2, fillOpacity: .1, interactive: false }).addTo(m);
    m.fitBounds(c.getBounds().pad(.15));
  }
  const pts = visible.filter(f => f.status !== 'rejected' && isFinite(f.lat) && isFinite(f.lng));
  pts.forEach(f => L.marker([f.lat, f.lng], { icon: pinIcon(lost ? 'found' : 'lost') }).addTo(m).bindPopup(lost ? (f.status === 'confirmed' ? 'Confirmed: where it was found' : 'Where it was found') : (f.status === 'confirmed' ? 'Confirmed: where the owner last saw it' : 'Where the owner says it was last seen')));
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
