/* =========================================================
   File a found report page.
   Optional: found.html?match=<lost report id> pre-fills the form
   (this is what the "I found this pet" button uses).
   ========================================================= */

const ctx = initReportForm('found');

function applyMatch({ form, host, map }, r) {
  const pick = (name, v) => { const i = form.querySelector(`input[name="${name}"][value="${v}"]`); if (i) i.checked = true; };
  pick('species', r.species); pick('size', r.size);
  ['color', 'breed'].forEach(n => { if (r[n]) form.querySelector(`.pills[data-pills="${n}"]`)?.pills.set(r[n]); });
  form.elements.brgy.value = r.brgy;
  form.dataset.matchFor = r.id;
  host.querySelector('.match-banner')?.remove();
  host.querySelector('.box').insertAdjacentHTML('afterbegin',
    `<p class="match-banner">You found &ldquo;${esc(r.name || [r.color, r.species].filter(Boolean).join(' '))}&rdquo; (lost in ${esc(r.brgy)})? Your details are added to that lost report for its owner to confirm. It does not create a new found report.</p>`);
  map.setView([r.lat, r.lng], 16);
}

if (ctx) {
  const id = new URLSearchParams(location.search).get('match');
  const r = id && allReports().find(x => x.id === id && reportState(x) === 'lost' && !isOwner(x));
  if (r) applyMatch(ctx, r);
}
