/* =========================================================
   Add pet report page: the person first chooses "I lost my pet" or
   "I found a pet", then the matching form is shown. Both forms live in
   add-report.html (#view-lost and #view-found) and are wired up by
   initReportForm() in report-form.js the first time they are opened.

   Optional URL parameters (these are what the buttons elsewhere use):
     add-report.html?type=lost | found      open that form straight away
     add-report.html?claim=<found report id> "This is my lost pet"  (lost form)
     add-report.html?match=<lost report id>  "I found this pet"     (found form)
     add-report.html?edit=<report id>         edit one of my reports (its own form)
   With claim, match or edit the type is already known, so the chooser is hidden.
   ========================================================= */

const params = new URLSearchParams(location.search);
const mainEl = document.querySelector('main');
const picker = document.querySelector('.type-pick');
const lead = document.querySelector('.type-lead');
const panes = { lost: $('#view-lost'), found: $('#view-found') };
const ctxs = {};

const LEAD = {
  none: 'Start by telling us what happened. We will show the right form.',
  lost: 'Tell us about your pet and where it was last seen. We will compare it with found reports nearby.',
  found: 'Found a pet that might belong to someone? Describe it and drop a pin where you found it.'
};

/* "I found this pet" (?match=): pre-fills the found form from the lost report and adds the find to that report.
   With ?update=1 it loads the find I sent earlier so I can change it. */
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
    document.title = 'Edit found report | TunTon';
    document.querySelectorAll('.view-head h1').forEach(h => { h.textContent = 'Edit your found report'; });
  }
}

/* Sets up one form the first time it is shown (the map needs its box to be visible). */
function startForm(k) {
  if (k in ctxs) return;
  const ctx = ctxs[k] = initReportForm(k);
  if (!ctx) return;

  if (k === 'found') {
    const id = params.get('match');
    const r = id && allReports().find(x => x.id === id && reportState(x) === 'lost' && !isOwner(x));
    if (r) applyMatch(ctx, r, params.get('update') ? myPendingFind(r) : null);
  }

  /* Once a report is filed, the chooser is no use: hide it. */
  ctx.form.addEventListener('submit', () => setTimeout(() => {
    if (!ctx.host.querySelector('.done').hidden) picker.hidden = true;
  }));
}

function show(k) {
  mainEl.classList.remove('is-choosing');   /* a type is picked: cards move up, the form shows below */
  Object.entries(panes).forEach(([name, pane]) => { pane.hidden = name !== k; });
  const radio = picker.querySelector(`input[value="${k}"]`);
  if (radio) radio.checked = true;
  lead.textContent = LEAD[k];
  startForm(k);
  ctxs[k]?.map.invalidateSize();
}

picker.addEventListener('change', e => show(e.target.value));

/* Which form do the URL parameters ask for? */
function requestedKind() {
  if (params.get('claim')) return 'lost';
  if (params.get('match')) return 'found';
  const editId = params.get('edit');
  if (editId) return read(REPORTS_KEY, []).find(x => x.id === editId && x.owner === myId)?.kind || 'lost';
  return null;
}

const fixed = requestedKind();      // claim / match / edit: the type is already decided
if (fixed) {
  picker.hidden = true;
  /* claim / match point at a report in the database: wait for it (a failed load still opens the form) */
  reportsReady.catch(() => {}).then(() => show(fixed));
} else {
  const t = params.get('type');
  if (t === 'lost' || t === 'found') show(t);
  else mainEl.classList.add('is-choosing');   /* nothing picked yet: two big cards in the middle of the page */
}