/* =========================================================
   File a found report page.
   Optional: found.html?match=<lost report id> pre-fills the form
   (this is what the "I found this pet" button uses).
   ========================================================= */

const ctx = initReportForm('found');

function applyMatch({ form, host, map }, r, mine) {
  const pick = (name, v) => { const i = form.querySelector(`input[name="${name}"][value="${v}"]`); if (i) i.checked = true; };
  pick('species', r.species); pick('size', r.size);
  if (r.species === 'Other' && form.elements.otherSpecies) form.elements.otherSpecies.value = r.otherSpecies || '';
  form.syncSpecies();
  ['color', 'breed'].forEach(n => { if (r[n]) form.querySelector(`.pills[data-pills="${n}"]`)?.pills.set(r[n]); });
  form.elements.brgy.value = r.brgy;
  form.dataset.matchFor = r.id;
  host.querySelector('.match-banner')?.remove();
  const what = esc(r.name || [r.color, speciesOf(r)].filter(Boolean).join(' '));
  host.querySelector('.box').insertAdjacentHTML('afterbegin', mine
    ? `<p class="match-banner">You are editing the found report you sent to &ldquo;${what}&rdquo; (lost in ${esc(r.brgy)}). Change what you need, then save. It does not create a new found report.</p>`
    : `<p class="match-banner">You found &ldquo;${what}&rdquo; (lost in ${esc(r.brgy)})? Your details are added to that lost report for its owner to confirm. It does not create a new found report.</p>`);
  map.setView([r.lat, r.lng], 16);
  if (mine) {
    /* "Edit my found report": load what I sent earlier, and save over it instead of filing another */
    form.fillFrom(mine);
    form.dataset.updating = '1';
    form.querySelector('button[type="submit"]').textContent = 'Save changes';
    host.querySelector('.again')?.remove();
    document.title = 'Edit found report | TunTon';
    host.querySelectorAll('h1').forEach(h => { h.textContent = 'Edit your found report'; });
  }
}

if (ctx) {
  const id = new URLSearchParams(location.search).get('match');
  const r = id && allReports().find(x => x.id === id && reportState(x) === 'lost' && !isOwner(x));
  if (r) applyMatch(ctx, r, new URLSearchParams(location.search).get('update') ? myPendingFind(r) : null);
}
