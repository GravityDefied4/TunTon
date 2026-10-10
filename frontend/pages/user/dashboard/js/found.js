/* =========================================================
   File a found report page.
   Optional: found.html?match=<lost report id> pre-fills the form
   (this is what the "I found this pet" button uses).
   ========================================================= */

const ctx = initReportForm('found');

function applyMatch({ form, host, map }, r) {
  const pick = (name, v) => { const i = form.querySelector(`input[name="${name}"][value="${v}"]`); if (i) i.checked = true; };
  pick('species', r.species); pick('size', r.size);
  if (r.color) form.elements.color.value = r.color;
  if (r.breed) form.elements.breed.value = r.breed;
  form.elements.brgy.value = r.brgy;
  form.dataset.matchFor = r.id;
  host.querySelector('.match-banner')?.remove();
  host.querySelector('.box').insertAdjacentHTML('afterbegin',
    `<p class="match-banner">You are reporting a possible match for &ldquo;${esc(r.name || [r.color, r.species].filter(Boolean).join(' '))}&rdquo; (lost in ${esc(r.brgy)}). Add where you found it and drop a pin.</p>`);
  map.setView([r.lat, r.lng], 16);
}

if (ctx) {
  const id = new URLSearchParams(location.search).get('match');
  const r = id && allReports().find(x => x.id === id);
  if (r) applyMatch(ctx, r);
}
