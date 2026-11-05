/* =========================================================
   Lost / found report form, shared by add-report.html.
   add-report.js calls initReportForm('lost') or initReportForm('found') when that form is first shown.
   ========================================================= */

/* ---------- Saving a NEW report to the database (POST /api/reports) ---------- */
/* Species, breeds, colors and barangays come from the database (GET /api/reports/lookups); the form's
   free-text answers are matched to them. Anything that has no match is kept in the description so it is not lost. */
let _lookups = null;
let _databaseColorNames = null;
const reportColorsFor = (species, otherSpecies = '') => {
  const speciesColors = colorsFor(species, otherSpecies);
  if (!_databaseColorNames) return speciesColors;
  const allowed = new Set(_databaseColorNames.map(normalizeOptionValue));
  return speciesColors.filter(color => allowed.has(normalizeOptionValue(color)));
};
const getLookups = () => _lookups || (_lookups = (async () => {
  const res = await authFetch('/reports/lookups');
  if (!res.ok) throw new Error('Could not reach the server. Please try again.');
  const data = (await res.json()).data;
  _databaseColorNames = (data.colors || []).map(color => color.name);
  return data;
})().catch(e => { _lookups = null; throw e; }));

const COLOR_ALIASES = { grey: 'gray' };
const plainName = t => String(t || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

/* A photo picked in the form is a downscaled JPEG data URL; the server wants a file. */
const dataUrlToBlob = d => {
  const [head, b64] = d.split(','), bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: (head.match(/:(.*?);/) || [])[1] || 'image/jpeg' });
};

/* Sends a response to someone else's report to the server (POST /api/claims, or PUT /api/claims/:id when `prev`
   is the claim being edited). It is stored in the database, so the owner of the report sees it.
   kind 'find'  = "I found this pet" on a LOST report  (claim_type found_it)
   kind 'claim' = "This is my lost pet" on a FOUND report (claim_type my_pet). `f` is the FormData of the form. */
async function sendClaim(kind, reportId, f, photos, prev) {
  const fd = new FormData(), find = kind === 'find';
  /* On an edit every field is sent, even an empty one, so a cleared box is cleared on the server too. */
  const put = (k, v) => { v = String(v ?? '').trim(); if (v || prev) fd.append(k, v); };
  if (!prev) fd.append('report_id', reportId);
  put('description', find ? f.get('howfound') : f.get('description'));
  put('markings', f.get('markings'));
  put('event_date', f.get('date'));
  put('contact', f.get('contact'));
  put('facebook', f.get('facebook'));
  fd.append('lat', f.get('lat')); fd.append('lng', f.get('lng'));
  if (find) put('pet_location', f.get('where'));
  else {
    const sp = f.get('species');
    put('pet_name', f.get('name'));
    put('species', sp === 'Other' ? f.get('otherSpecies') : sp);
    put('breed', f.get('breed'));
    put('color', f.get('color'));
    put('size', String(f.get('size') || '').toLowerCase().replace(' ', '_'));
  }
  /* photos already on the claim stay (or are removed); new ones are uploaded */
  const kept = photos.filter(p => p.pid).map(p => p.pid);
  const gone = (prev?.photoIds || []).filter(id => !kept.includes(id));
  if (gone.length) fd.append('remove_photo_ids', gone.join(','));
  photos.filter(p => !p.pid).forEach((p, i) => fd.append('photos', dataUrlToBlob(p.data), 'photo-' + (i + 1) + '.jpg'));
  return ClaimsAPI.save(fd, prev?.id);
}

/* Turns the form into the multipart body the reports API expects (species, breed and color are plain text columns).
   `f` is the FormData of the form, `photos` the chosen [{ name, data, pid? }]; photos with a pid are already on the server. */
async function reportFormData(k, f, photos) {
  const lk = await getLookups().catch(() => null);
  const fd = new FormData();
  const speciesName = f.get('species'), typedAnimal = (f.get('otherSpecies') || '').trim();
  const text = n => String(f.get(n) ?? '').trim();
  fd.append('species', speciesName === 'Other' && typedAnimal ? typedAnimal : speciesName);
  fd.append('breed', text('breed') || 'Unknown');
  fd.append('color', text('color'));
  fd.append('size', String(f.get('size')).toLowerCase().replace(' ', '_'));
  if (text('sex')) fd.append('sex', text('sex').toLowerCase());
  fd.append('event_date', f.get('date'));
  fd.append('lat', f.get('lat'));
  fd.append('lng', f.get('lng'));
  if (text('name')) fd.append('pet_name', text('name'));
  fd.append('markings', text('markings'));
  fd.append('description', [f.get('description'), f.get('howfound'), f.get('where') && 'Pet is now: ' + f.get('where')]
    .map(x => String(x || '').trim()).filter(Boolean).join('\n'));
  const brgy = lk?.barangays?.find(b => plainName(b.name) === plainName(f.get('brgy')));
  if (brgy) fd.append('barangay_id', brgy.barangay_id);   // otherwise the server picks the nearest barangay
  if (k === 'lost') fd.append('search_radius_km', Math.min(5, Math.max(1, Math.round((+f.get('zone') || 1000) / 1000))));
  /* Contact is one box (phone or email). Only a phone number or a web address fits the report's own columns. */
  const contact = text('contact').replace(/[\s-]/g, '');
  if (/^(\+63|09)\d{9}$/.test(contact)) fd.append('phone', contact);
  if (/^https?:\/\//i.test(text('facebook'))) fd.append('facebook_profile_link', text('facebook'));
  for (const [i, p] of photos.filter(x => !x.pid).entries()) {
    const blob = await (await fetch(p.data)).blob();   // the photo is a downscaled JPEG data URL
    fd.append('photos', blob, (p.name || 'photo' + (i + 1)).replace(/\.[^.]+$/, '') + '.jpg');
  }
  return fd;
}

async function sendReport(method, path, fd) {
  let res;
  try { res = await authFetch(path, { method, body: fd }); }
  catch { throw new Error('Could not reach the server. Please try again.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || 'Could not save the report. Please try again.');
  reportsReady = loadReports();   // refresh the cache so the next page sees the change
  reportsReady.catch(() => {});
  return body.data.report;
}

/* NEW report: POST /api/reports. Resolves to the saved report, or throws an Error safe to show the person. */
async function createReport(k, f, photos) {
  const fd = await reportFormData(k, f, photos);
  fd.append('type', k);
  return sendReport('POST', '/reports', fd);
}

/* EDIT own report: PUT /api/reports/:id. Photos no longer in the form are removed on the server. */
async function updateReport(existing, k, f, photos) {
  const fd = await reportFormData(k, f, photos);
  const kept = photos.filter(p => p.pid).map(p => p.pid);
  const gone = (existing.photoIds || []).filter(id => !kept.includes(id));
  if (gone.length) fd.append('remove_photo_ids', gone.join(','));
  return sendReport('PUT', '/reports/' + encodeURIComponent(existing.id), fd);
}

/* The form markup lives in add-report.html (#view-lost and #view-found). This only fills in what depends on the user or the day:
   barangay list, saved barangay, today's date, contact, and the "other animal" suggestions. */
function fillForm(k, host) {
  const form = host.querySelector('form');
  form.elements.brgy.insertAdjacentHTML('beforeend', BRGY.map(b => `<option${b === prof().brgy ? ' selected' : ''}>${b}</option>`).join(''));
  /* defaultValue (not .value) so "File another" / form.reset() brings these back */
  form.elements.date.defaultValue = form.elements.date.value = form.elements.date.max = today;
  form.elements.contact.defaultValue = form.elements.contact.value = prof().phone || sess?.email || '';
  form.querySelector('#' + k + '-otherspecies-list').innerHTML = OTHER_ANIMALS.map(a => `<option value="${a}"></option>`).join('');
  const targetColorList = form.querySelector('#' + k + '-color-list');
  if (targetColorList) targetColorList.innerHTML = reportColorsFor('').map(color => `<option value="${esc(color)}"></option>`).join('');
}

/* Full-size preview of one uploaded photo (the dialog is created on first use). */
function previewPhoto(name, src) {
  let d = document.getElementById('photo-preview');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'photo-preview'; d.className = 'dialog preview';
    d.setAttribute('aria-label', 'Photo preview');
    d.innerHTML = '<button type="button" class="dialog-close" aria-label="Close">&times;</button><img alt=""><p class="preview-name"></p>';
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('.dialog-close')) d.close(); });
    document.body.append(d);
  }
  const img = d.querySelector('img');
  img.src = src; img.alt = name;
  d.querySelector('.preview-name').textContent = name;
  d.showModal();
}

/* Turns each .pills box into a tag input: type a word, press space (or Enter / comma) and it becomes a pill. */
/* ---------- Inline field errors ----------
   setFieldError(el, true, 'message')  -> red border on the field + message right under it
   setFieldError(el, false)            -> clears both
   `el` can be any control inside the field (input, select, textarea, radio, pills input, file input, .pick map). */
const FIELD_BOX = '.pills, .chips, .drop, .pick';   // wrapper that gets the red border when the control is not the visible box itself

function getFieldAnchor(el) {
  return el.closest(FIELD_BOX) || el.closest('fieldset') || el;
}

function getFieldErrorNode(el, create = true) {
  if (!el) return null;
  const anchor = getFieldAnchor(el);
  const parent = anchor.parentElement;
  if (!parent) return null;
  const key = el.id || el.name || anchor.dataset?.pills || anchor.dataset?.field || 'field';
  let msg = [...parent.querySelectorAll(':scope > .field-error')].find(n => n.dataset.field === key);
  if (!msg && create) {
    msg = document.createElement('p');
    msg.className = 'field-error';
    msg.id = 'err-' + key + '-' + Math.random().toString(36).slice(2, 7);
    msg.dataset.field = key;
    msg.setAttribute('role', 'alert');
    msg.hidden = true;
    parent.insertBefore(msg, anchor.nextElementSibling || null);   // directly under the field
  }
  return msg;
}

function setFieldError(el, invalid, message) {
  if (!el) return;
  const box = el.closest(FIELD_BOX);
  const fieldset = el.closest('fieldset');
  const control = box ? (box.matches('.pills') ? el.closest('.pills').querySelector('.pills-input') : el) : el;

  if (box) box.classList.toggle('is-invalid', invalid);
  if (fieldset && !box?.matches('.pills, .drop, .pick')) fieldset.classList.toggle('is-invalid', invalid);
  if (el.matches('input:not([type=radio]), select, textarea')) el.classList.toggle('is-invalid', invalid && !box?.matches('.pills'));
  if (control && control.setAttribute) control.setAttribute('aria-invalid', invalid ? 'true' : 'false');

  const msg = getFieldErrorNode(el, invalid);
  if (!msg) return;
  if (invalid && message) {
    msg.textContent = message;
    msg.hidden = false;
    control?.setAttribute?.('aria-describedby', msg.id);
  } else {
    msg.textContent = '';
    msg.hidden = true;
    control?.removeAttribute?.('aria-describedby');
  }
}

/* Moves the user to the field that needs fixing: scroll it into view, then focus it when it can be focused. */
function focusField(el) {
  if (!el) return;
  (getFieldAnchor(el)).scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (typeof el.focus === 'function') el.focus({ preventScroll: true });
}

function clearFormErrors(form) {
  form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  form.querySelectorAll('[aria-invalid="true"]').forEach(el => el.setAttribute('aria-invalid', 'false'));
  form.querySelectorAll('[aria-describedby^="err-"]').forEach(el => el.removeAttribute('aria-describedby'));
  form.querySelectorAll('.field-error').forEach(msg => { msg.textContent = ''; msg.hidden = true; });
}

/* Friendly, specific wording for required fields (falls back to the label for anything not listed). */
const REQUIRED_MESSAGES = {
  brgy: 'Please select a barangay.',
  date: 'Please choose a date.',
  contact: 'Please enter a phone number or email so people can reach you.',
  description: 'Please describe your pet so others can recognize it.',
  howfound: 'Please tell us how you found the pet.',
  name: 'Please enter your pet’s name.',
  otherSpecies: 'Please tell us what kind of animal it is.'
};

function normalizeOptionValue(value) {
  return String(value || '').replace(/&/g, ' and ').replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function allowedPillValues(kind, species) {
  if (kind === 'color') return new Set(reportColorsFor(species).concat('Grey').map(normalizeOptionValue));   // "Grey" is accepted as another spelling of Gray
  if (kind === 'breed') {
    const values = Object.values(BREEDS).flat().concat(Object.values(OTHER_BREEDS).flat());
    return new Set(values.map(normalizeOptionValue));
  }
  return new Set();
}

function isValidPillValue(kind, value, species) {
  const text = normalizeOptionValue(value);
  if (!text) return false;
  return allowedPillValues(kind, species).has(text);
}

function splitPillValues(raw, kind) {
  if (!raw) return [];
  const split = kind === 'breed' ? /[,;]+|\s+and\s+/i : /[,;]+|\s+and\s+|\s+/;
  return String(raw)
    .split(split)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => !/^(and|&)$/.test(v.toLowerCase()));
}

function parsePillValues(raw, kind, species) {
  return splitPillValues(raw, kind).filter(v => isValidPillValue(kind, v, species));
}

function setupPills(form) {
  const MAX = 8;
  form.querySelectorAll('.pills').forEach(box => {
    const input = box.querySelector('.pills-input'), hidden = form.elements[box.dataset.pills];
    const speciesNow = () => {
      const selected = form.querySelector('input[name="species"]:checked')?.value || '';
      // For Other, validate against the actual animal type (Rabbit, Bird, etc.), not one generic list.
      return selected === 'Other' ? (form.elements.otherSpecies?.value.trim() || 'Other') : selected;
    };
    let list = [];
    const draw = () => {
      box.querySelectorAll('.pill').forEach(p => p.remove());
      list.forEach((t, i) => input.insertAdjacentHTML('beforebegin', `<span class="pill">${esc(t)}<button type="button" data-i="${i}" aria-label="Remove ${esc(t)}">&times;</button></span>`));
      hidden.value = list.join(', ');
    };
    const add = raw => {
      const typed = String(raw || '').trim().replace(/^[,;]+|[,;]+$/g, '');
      if (!typed) return;
      const vals = parsePillValues(typed, box.dataset.pills, speciesNow());
      /* remember words that were not on the suggestion list, so validation can name them in its error message */
      box.dataset.rejected = splitPillValues(typed, box.dataset.pills).filter(v => !isValidPillValue(box.dataset.pills, v, speciesNow())).join(' ');
      if (!vals.length) return;
      vals.forEach(v => {
        if (list.length < MAX && !list.some(x => normalizeOptionValue(x) === normalizeOptionValue(v))) list.push(v);
      });
    };
    const commit = () => { add(input.value); input.value = ''; draw(); };
    const sep = box.dataset.sep === 'comma' ? /[,;]/ : /[\s,;]/;
    const sepEnd = new RegExp(sep.source + '$'), sepSplit = new RegExp(sep.source + '+');
    input.addEventListener('input', e => {
      box.dataset.rejected = '';
      /* picked from the suggestion list: make it a pill right away */
      if (box.dataset.sep === 'comma' && (e.inputType === 'insertReplacementText' || (!e.inputType && input.value))) { commit(); return; }
      if (!sep.test(input.value)) return;                      // no separator yet: keep typing
      const parts = input.value.split(sepSplit), rest = sepEnd.test(input.value) ? '' : parts.pop();
      parts.forEach(add); input.value = rest; draw();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); draw(); }
    });
    input.addEventListener('blur', commit);
    box.addEventListener('click', e => {
      const x = e.target.closest('button[data-i]');
      if (x) { list.splice(+x.dataset.i, 1); draw(); }
      input.focus();
    });
    form.addEventListener('reset', () => setTimeout(() => { list = []; input.value = ''; draw(); }));
    box.pills = {
      commit,
      /* the species changed: drop any tag that does not fit it any more (a blue dog) */
      refilter() { list = list.filter(v => isValidPillValue(box.dataset.pills, v, speciesNow())); draw(); },
      clear() { list = []; input.value = ''; draw(); },
      set(str) {   // "White and brown" -> White, Brown (breed keeps spaces: "Shih Tzu")
        list = []; input.value = '';
        const split = box.dataset.pills === 'breed' ? /[,;]+|\s+and\s+/i : /[,;]+|\s+and\s+|\s+/;
        const tokens = typeof str === 'string' ? str.split(split) : [];
        tokens.filter(Boolean).forEach(v => {
          const values = parsePillValues(v, box.dataset.pills, speciesNow());
          values.forEach(value => {
            if (!list.some(x => normalizeOptionValue(x) === normalizeOptionValue(value))) list.push(value);
          });
        });
        draw();
      }
    };
  });
}

function setupForm(k, host) {
  const form = host.querySelector('form'), err = host.querySelector('.err');
  const pickEl = host.querySelector('.pick');
  pickEl.dataset.field = 'location';
  const m = L.map(pickEl).setView(DAGUPAN, 15);
  tiles(m);
  lockToDagupan(m);
  setupPills(form);

  /* Species drives the form: "Other" asks for the animal, and the breed box only works once a species is chosen,
     with suggestions that match that species. */
  const otherBox = form.querySelector('.other-species'), otherInput = form.elements.otherSpecies;
  const breedBox = form.querySelector('.pills[data-pills="breed"]'), breedInput = breedBox.querySelector('.pills-input');
  const breedList = form.querySelector('#' + k + '-breed-list');
  const sexBox = form.querySelector('.sex-choice');
  const species = () => form.querySelector('input[name="species"]:checked')?.value || '';
  const fillBreeds = () => {
    const sp = species();
    const opts = sp === 'Other' ? (OTHER_BREEDS[otherInput.value.trim().toLowerCase()] || []) : (BREEDS[sp] || []);
    breedList.innerHTML = opts.map(b => `<option value="${esc(b)}"></option>`).join('');
  };
  const syncSpecies = () => {
    const sp = species(), other = sp === 'Other';
    otherBox.hidden = !other; otherInput.disabled = !other; otherInput.required = other;
    if (!other) otherInput.value = '';
    breedInput.disabled = !sp; breedBox.classList.toggle('is-disabled', !sp);
    breedInput.placeholder = !sp ? 'Choose a species first' : other ? 'Breed or variety, then Enter' : 'e.g. ' + (sp === 'Dog' ? 'Shih Tzu' : 'Persian') + ', then Enter';
    fillBreeds();
    const colorList = form.querySelector('#' + k + '-color-list');
    if (colorList) colorList.innerHTML = reportColorsFor(sp, otherInput.value).map(c => `<option value="${esc(c)}"></option>`).join('');
  };
  form.syncSpecies = syncSpecies;
  const clearSpeciesDependentFields = () => {
    breedBox.pills.clear();
    const colorBox = form.querySelector('.pills[data-pills="color"]');
    colorBox?.pills.clear();
    if (colorBox) colorBox.dataset.rejected = '';
    setFieldError(breedBox.querySelector('.pills-input'), false);
    if (colorBox) setFieldError(colorBox.querySelector('.pills-input'), false);
  };
  form.querySelectorAll('input[name="species"]').forEach(r => r.addEventListener('change', () => {
    clearSpeciesDependentFields(); // changing Dog/Cat/Other invalidates the previous breed and colors
    syncSpecies();
    if (species() === 'Other') otherInput.focus();
    lastOtherSpecies = normalizeOptionValue(otherInput.value);
  }));
  let lastOtherSpecies = normalizeOptionValue(otherInput.value);
  const refreshOtherAnimalOptions = () => {
    fillBreeds();
    const colorList = form.querySelector('#' + k + '-color-list');
    if (colorList) colorList.innerHTML = reportColorsFor('Other', otherInput.value).map(c => `<option value="${esc(c)}"></option>`).join('');
    form.querySelector('.pills[data-pills="color"]')?.pills.refilter();
  };
  otherInput.addEventListener('input', refreshOtherAnimalOptions);
  otherInput.addEventListener('change', () => {
    const nextOtherSpecies = normalizeOptionValue(otherInput.value);
    if (species() === 'Other' && nextOtherSpecies !== lastOtherSpecies) {
      clearSpeciesDependentFields(); // e.g. Rabbit -> Bird: reset details tied to the old animal type
    }
    lastOtherSpecies = nextOtherSpecies;
    refreshOtherAnimalOptions();
  });
  form.addEventListener('reset', () => setTimeout(syncSpecies));
  syncSpecies();
  getLookups().then(() => {
    const colorList = form.querySelector('#' + k + '-color-list');
    if (colorList) colorList.innerHTML = reportColorsFor(species(), otherInput.value).map(color => `<option value="${esc(color)}"></option>`).join('');
    form.querySelector('.pills[data-pills="color"]')?.pills.refilter();
  }).catch(() => { /* Submission will show a connection error if lookups remain unavailable. */ });

  // A user who recognizes a found-pet report can send their lost-pet details to THAT found report (add-report.html?claim=<id>).
  // This never creates a lost report of its own: the details are added to the found report for its finder to confirm.
  // The user must still confirm the missing date/location and upload a photo before submitting.
  let claimTarget = null, claimEdit = null;
  if (k === 'lost') {
    const claimId = new URLSearchParams(location.search).get('claim');
    if (claimId) {
      const foundReport = mergedReports().find(r => String(r.id) === claimId && r.kind === 'found' && !isOwner(r) && !confirmedClaim(r));
      if (foundReport) {
        claimTarget = foundReport; form.dataset.claimFor = foundReport.id;
        if (new URLSearchParams(location.search).get('update')) claimEdit = myPendingClaim(foundReport);
        const speciesRadio = form.querySelector(`input[name="species"][value="${CSS.escape(foundReport.species || '')}"]`);
        if (speciesRadio) speciesRadio.checked = true;
        syncSpecies();
        if (foundReport.species === 'Other') otherInput.value = foundReport.otherSpecies || '';
        refreshOtherAnimalOptions();
        form.elements.name.value = foundReport.name || '';
        form.elements.size.value = foundReport.size || '';
        breedBox.pills.set(foundReport.breed || '');
        form.querySelector('.pills[data-pills="color"]').pills.set(foundReport.color || '');
        form.elements.markings.value = foundReport.markings || '';
        form.elements.description.value = foundReport.description || foundReport.howFound || '';
        const banner = document.createElement('p');
        banner.className = 'match-banner';
        banner.textContent = claimEdit ? 'You are editing the lost report you sent to this found pet. Change what you need, then save. It does not create a new lost report.' : 'You are saying this found pet is yours. Your lost pet details are added to that found report for its finder to confirm. It does not create a new lost report. Check the details, choose when and where your pet was last seen, add a photo, and drop a pin.';
        form.parentElement.insertBefore(banner, form);
      }
    }
  }

  const zone = form.elements.zone;
  let pin = null, circle = null, lastOk = null;
  const draw = () => {
    const ll = pin.getLatLng();
    form.elements.lat.value = ll.lat; form.elements.lng.value = ll.lng;
    if (zone) { if (circle) circle.setLatLng(ll).setRadius(+zone.value); else circle = L.circle(ll, { radius: +zone.value, color: '#d93636', weight: 2, fillOpacity: .1, interactive: false }).addTo(m); }
  };
  const OUTSIDE = 'TunTon only covers Dagupan City. Please choose a spot on land inside the city.';
  const put = (ll, pan) => {
    if (!inDagupan(ll.lat, ll.lng)) { setFieldError(pickEl, true, OUTSIDE); return; }
    setFieldError(pickEl, false);
    if (!pin) { pin = L.marker(ll, { draggable: true, icon: pinIcon(k) }).addTo(m); pin.on('drag', draw);
      /* A pin dragged out of the city snaps back to its last valid spot. */
      pin.on('dragend', () => { const at = pin.getLatLng(); if (inDagupan(at.lat, at.lng)) lastOk = at; else { pin.setLatLng(lastOk); draw(); setFieldError(pickEl, true, OUTSIDE); } }); }
    else pin.setLatLng(ll);
    lastOk = pin.getLatLng(); draw(); if (pan) m.setView(ll, 16);
  };
  if (claimTarget) m.setView([claimTarget.lat, claimTarget.lng], 16);
  m.on('click', e => put(e.latlng));
  zone?.addEventListener('change', () => pin && draw());
  host.querySelector('.locate-pin').addEventListener('click', () => {
    getPosition({ enableHighAccuracy: true, timeout: 10000 }).then(p => {
      if (p) put(L.latLng(p.lat, p.lng), true);
      else setFieldError(pickEl, true, 'Could not get your location. Tap the map instead.');
    });
  });

  /* Photos: several allowed, listed by file name. Click a name to preview it. */
  /* A report takes up to 5 photos; a response to someone else's report (a claim) takes up to 3 (server limit). */
  const photoLimit = () => (form.dataset.matchFor || form.dataset.claimFor) ? 3 : 5;
  const input = form.elements.photo, fileList = host.querySelector('.files');
  let photos = [];   // [{ name, size, data }]  (data = downscaled JPEG, so it fits in storage)
  const kb = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const dropZone = host.querySelector('.drop'), uploadStatus = host.querySelector('.upload-status');
  const drawFiles = () => {
    fileList.innerHTML = photos.map((p, i) => `
      <li class="file">
        <button type="button" class="file-open" data-i="${i}" title="Preview ${esc(p.name)}">
          <img class="file-thumb" src="${p.data}" alt="">
          <span class="file-name">${esc(p.name)}</span><span class="file-size">${kb(p.size)}</span>
        </button>
        ${i === 0 ? '<span class="file-main">Main photo</span>' : ''}
        <button type="button" class="file-remove" data-i="${i}" aria-label="Remove ${esc(p.name)}">&times;</button>
      </li>`).join('');
    dropZone.classList.toggle('has-photos', photos.length > 0);
    uploadStatus.textContent = photos.length
      ? `${photos.length} of ${photoLimit()} photo${photoLimit() === 1 ? '' : 's'} added`
      : '';
    dropZone.querySelector('.upload-action').textContent = photos.length ? 'Add more photos' : 'Choose photos';
  };
  const shrink = f => new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const s = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', .75));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
  input.addEventListener('change', async () => {
    setFieldError(input, false);
    const picked = [...input.files].filter(f => f.type.startsWith('image/'));
    input.value = '';   // so the same file can be picked again later
    for (const f of picked) {
      if (photos.length >= photoLimit()) { setFieldError(input, true, `You can add up to ${photoLimit()} photos.`); break; }
      if (photos.some(p => p.name === f.name && p.size === f.size)) continue;
      try { photos.push({ name: f.name, size: f.size, data: await shrink(f) }); }
      catch { setFieldError(input, true, `Could not read "${f.name}". Try a JPG or PNG.`); }
    }
    drawFiles();
  });
  fileList.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const i = +b.dataset.i;
    if (b.classList.contains('file-remove')) { photos.splice(i, 1); setFieldError(input, false); drawFiles(); }
    else previewPhoto(photos[i].name, photos[i].data);
  });

  /* ---------- Edit mode: add-report.html?edit=<id> (owner only) ---------- */
  const editId = new URLSearchParams(location.search).get('edit');
  const editing = editId ? mergedReports().find(x => x.id === editId && x.owner === myId && x.kind === k && x.status === 'active') : null;
  if (editId && !editing) {
    const note = document.createElement('p');
    note.className = 'match-banner';
    note.textContent = 'This report could not be found, is no longer active, or is not yours to edit.';
    form.parentElement.insertBefore(note, form); form.hidden = true;
  }
  /* Fills the whole form from a saved object (a report, or a response such as a find or a claim).
     Fields the object does not have are left alone, so a prefilled breed/color is not wiped. */
  const fillFrom = r => {
    const set = (n, v) => { if (form.elements[n] && v != null) form.elements[n].value = v; };
    const radio = r.species && form.querySelector(`input[name="species"][value="${CSS.escape(r.species)}"]`);
    if (radio) radio.checked = true;
    syncSpecies();
    if (r.species === 'Other') otherInput.value = r.otherSpecies || '';
    set('name', r.name); set('size', r.size); set('sex', r.sex); set('markings', r.markings);
    set('description', r.description); set('howfound', r.howFound); set('where', r.where);
    set('brgy', r.brgy); set('date', r.date); set('zone', r.zone || ''); set('contact', r.contact); set('facebook', r.facebook || '');
    if ('breed' in r) breedBox.pills.set(r.breed || '');
    if ('color' in r) form.querySelector('.pills[data-pills="color"]').pills.set(r.color || '');
    photos = (r.photos && r.photos.length ? r.photos : [r.photo]).filter(Boolean).map((d, i) => ({ name: 'Photo ' + (i + 1), size: r.photoIds ? 0 : Math.round(d.length * .75), data: d, pid: r.photoIds?.[i] }));   // pid = photo already saved on the server (editing a claim)
    drawFiles();
    put(L.latLng(r.lat, r.lng), true);
    setupAutoGrowTextareas?.(form);
  };
  form.fillFrom = fillFrom;

  if (editing) {
    fillFrom(editing);
    const banner = document.createElement('p');
    banner.className = 'match-banner';
    banner.textContent = 'You are editing your report. Change what you need, then save.';
    form.parentElement.insertBefore(banner, form);
    form.querySelector('button[type="submit"]').textContent = 'Save changes';
    document.title = 'Edit report | TunTon';
    document.querySelectorAll('.view-head h1').forEach(h => { h.textContent = 'Edit your ' + k + ' report'; });
  }

  if (claimEdit) {
    fillFrom(claimEdit);
    form.dataset.updating = '1';
    form.querySelector('button[type="submit"]').textContent = 'Save changes';
    document.title = 'Edit lost report | TunTon';
    document.querySelectorAll('.view-head h1').forEach(h => { h.textContent = 'Edit your lost report'; });
  }


  /* ---------- Step-by-step wizard (like Google Forms): one step at a time, Back / Next, progress bar ---------- */
  /* An error goes away as soon as the user fixes that field */
  const liveClear = e => {
    const t = e.target;
    if (!t.closest || !(t.matches('input, select, textarea'))) return;
    const box = t.closest(FIELD_BOX), fs = t.closest('fieldset');
    const flagged = t.classList.contains('is-invalid') || box?.classList.contains('is-invalid') || fs?.classList.contains('is-invalid');
    if (flagged) setFieldError(t, false);
  };
  form.addEventListener('input', liveClear);
  form.addEventListener('change', liveClear);

  const steps = [...form.querySelectorAll('.step')];
  const btnBack = form.querySelector('.wiz-back'), btnNext = form.querySelector('.wiz-next'), btnSubmit = form.querySelector('.wiz-submit');
  const stepNames = steps.map(s => s.querySelector('h2').textContent);
  const progress = document.createElement('nav');
  progress.className = 'wizard-progress';
  progress.setAttribute('aria-label', 'Form progress');
  progress.innerHTML = `<ol class="wp-dots">${steps.map((_, i) =>
    `<li><button type="button" class="wp-dot" data-i="${i}" aria-label="Go to step ${i + 1}: ${esc(stepNames[i])}"><b>${i + 1}</b><span>${esc(stepNames[i])}</span></button></li>`).join('')}</ol>`;
  form.insertBefore(progress, form.firstChild);
  let cur = 0;

  const labelOf = el => (el.id && form.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || 'this field';
  const validatePillGroup = (kind, label) => {
    const hidden = form.elements[kind];
    const input = form.querySelector(`.pills[data-pills="${kind}"] .pills-input`);
    const raw = [hidden?.value || '', input?.value || ''].filter(Boolean).join(', ');
    if (!raw.trim()) return null;
    const sp = form.querySelector('input[name="species"]:checked')?.value || '';
    const invalid = splitPillValues(raw, kind).filter(v => !isValidPillValue(kind, v, sp));
    if (invalid.length) {
      const msg = kind === 'color' && COLORS_BY_SPECIES[sp]
        ? `“${invalid.join(', ')}” is not a usual ${sp.toLowerCase()} color. Pick one from the suggestions list.`
        : `“${invalid.join(', ')}” is not a recognized ${label}. Pick one from the suggestions list.`;
      setFieldError(input, true, msg);
      return { msg, el: input };
    }
    return null;
  };

  /* Returns { msg, el } for the first problem in step i, or null when the step is complete. */
  const stepError = i => {
    const s = steps[i];
    /* remember what was typed: commit() drops words that are not on the suggestion list */
    const typed = {};
    s.querySelectorAll('.pills').forEach(b => { typed[b.dataset.pills] = b.querySelector('.pills-input').value.trim() || b.dataset.rejected || ''; b.pills.commit(); });
    clearFormErrors(form);
    const unrecognized = (kind, label) => {
      const el = s.querySelector(`.pills[data-pills="${kind}"] .pills-input`);
      el.value = typed[kind];                                   // put the word back so the user can see and fix it
      const msg = `“${typed[kind]}” is not a recognized ${label}. Pick one from the suggestions list.`;
      setFieldError(el, true, msg);
      return { msg, el };
    };
    if (s.contains(form.elements.photo) && !photos.length) {
      const el = s.querySelector('.drop input');
      setFieldError(el, true, 'Please add at least one photo of the pet.');
      return { msg: 'Please add at least one photo of the pet.', el };
    }
    if (s.querySelector('input[name="species"]') && !s.classList.contains('is-locked')) {
      const speciesInput = s.querySelector('input[name="species"]');
      if (!species()) { setFieldError(speciesInput, true, 'Please choose a species.'); return { msg: 'Please choose a species.', el: speciesInput }; }
      if (species() === 'Other' && !otherInput.value.trim()) { setFieldError(otherInput, true, REQUIRED_MESSAGES.otherSpecies); return { msg: REQUIRED_MESSAGES.otherSpecies, el: otherInput }; }
      if (form.elements.name?.required && !form.elements.name.value.trim()) { setFieldError(form.elements.name, true, REQUIRED_MESSAGES.name); return { msg: REQUIRED_MESSAGES.name, el: form.elements.name }; }
      if (!form.elements.color.value && typed.color) return unrecognized('color', 'color');
      if (!form.elements.color.value) { const el = s.querySelector('.pills[data-pills="color"] input'); const msg = 'Please add the main color. Type one (e.g. brown) and press the space bar.'; setFieldError(el, true, msg); return { msg, el }; }
      const colorIssue = validatePillGroup('color', 'color');
      if (colorIssue) return colorIssue;
      if (!form.elements.breed.value && typed.breed) return unrecognized('breed', 'breed');
      if (form.elements.breed && form.elements.breed.value) {
        const breedIssue = validatePillGroup('breed', 'breed');
        if (breedIssue) return breedIssue;
      }
      if (!form.querySelector('input[name="size"]:checked')) { const el = s.querySelector('input[name="size"]'); setFieldError(el, true, 'Please choose a size.'); return { msg: 'Please choose a size.', el }; }
      if (!form.querySelector('input[name="sex"]:checked')) { const el = s.querySelector('input[name="sex"]'); setFieldError(el, true, 'Please choose the pet’s sex.'); return { msg: 'Please choose the pet’s sex.', el }; }
    }
    for (const el of s.querySelectorAll('input:not([type=radio]):not([type=hidden]):not([type=file]):not(.pills-input), select, textarea')) {
      if (el.disabled) continue;
      if (el.required && !el.value.trim()) { const msg = REQUIRED_MESSAGES[el.name] || `Please fill in “${labelOf(el)}”.`; setFieldError(el, true, msg); return { msg, el }; }
      if (!el.checkValidity()) { const msg = el.validationMessage || `Please check “${labelOf(el)}”.`; setFieldError(el, true, msg); return { msg, el }; }
    }
    if (s.contains(form.elements.lat) && !pin) { const el = pickEl, msg = 'Please tap the map to drop a pin on the spot.'; setFieldError(el, true, msg); return { msg, el }; }
    return null;
  };

  const show = (i, { scroll = true, keepErrors = false } = {}) => {
    cur = Math.max(0, Math.min(steps.length - 1, i));
    if (!keepErrors) clearFormErrors(form);
    steps.forEach((s, n) => { s.hidden = n !== cur; });
    btnBack.hidden = cur === 0;
    btnNext.hidden = cur === steps.length - 1;
    btnSubmit.hidden = cur !== steps.length - 1;
    /* the line leading into a step fills once the step before it is done */
    progress.querySelectorAll('.wp-dots li').forEach((li, n) => li.classList.toggle('is-linked', n > 0 && n <= cur));
    progress.querySelectorAll('.wp-dot').forEach((d, n) => {
      d.classList.toggle('is-current', n === cur);
      d.classList.toggle('is-done', n < cur);
      d.toggleAttribute('aria-current', n === cur);
    });
    err.textContent = '';
    m.invalidateSize();                       // the map is created while hidden: re-measure when its step appears
    if (scroll) {
      const h = steps[cur].querySelector('h2');
      h.tabIndex = -1; h.focus({ preventScroll: true });
      progress.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  /* Go to step n. Moving forward checks every step on the way, so nobody can skip a required one. */
  const goTo = n => {
    for (let i = cur; i < n; i++) {
      const bad = stepError(i);
      if (bad) { show(i, { scroll: false, keepErrors: true }); focusField(bad.el); return false; }
    }
    show(n);
    return true;
  };
  btnNext.addEventListener('click', () => goTo(cur + 1));
  btnBack.addEventListener('click', () => show(cur - 1));
  progress.addEventListener('click', e => { const d = e.target.closest('.wp-dot'); if (d) goTo(+d.dataset.i); });
  form.addEventListener('reset', () => setTimeout(() => show(0, { scroll: false })));
  form.wizard = { goTo, show, stepError, steps };
  show(0, { scroll: false });

  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    /* Enter pressed in the middle of the form: treat it as "Next" instead of submitting */
    if (cur < steps.length - 1) { goTo(cur + 1); return; }
    /* Last step: check every step once more and jump back to the first one that is incomplete */
    for (let i = 0; i < steps.length; i++) {
      const bad = stepError(i);
      if (bad) { show(i, { scroll: false, keepErrors: true }); focusField(bad.el); return; }
    }
    const f = new FormData(form);
    const matchId = form.dataset.matchFor || '';
    if (matchId) {
      /* "I found this pet" on a lost report: add a find to THAT report. No new found report is created.
         The report only shows as found once its owner confirms a find. */
      const base = mergedReports().find(x => x.id === matchId);
      if (!base) { err.textContent = 'That lost report is no longer available.'; return; }
      if (isOwner(base)) { err.textContent = 'This is your own lost report.'; return; }
      const prev = form.dataset.updating ? myPendingFind(base) : null;
      /* Saved in the database (POST/PUT /api/claims), so the owner of the lost report sees it. */
      const btn = btnSubmit, label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Sending…';
      try { await sendClaim('find', matchId, f, photos, prev); }
      catch (ex) { err.textContent = ex.message === 'Failed to fetch' ? 'Could not reach the server. Please try again.' : ex.message; return; }
      finally { btn.disabled = false; btn.textContent = label; }
      host.querySelector('.done h2').textContent = prev ? 'Found report updated' : 'Found report sent';
      host.querySelector('.done p').textContent = prev ? 'Your changes have been saved on the lost report.' : 'Thank you! The owner of the lost report can now see your details and will confirm if this is their pet.';
      host.querySelector('.done .actions a').href = 'report.html?id=' + encodeURIComponent(matchId);
      host.querySelector('.done .actions a').textContent = 'View the report';
      host.querySelector('.see-matches').hidden = true;   /* a response to someone else's report has nothing to match */
      document.querySelector('.type-pick').hidden = true; document.querySelector('.type-lead').hidden = true;
      form.hidden = true; host.querySelector('.done').hidden = false;
      host.querySelector('.match-banner')?.remove(); delete form.dataset.matchFor; delete form.dataset.claimFor; delete form.dataset.updating;
      window.scrollTo(0, 0);
      return;
    }
    const claimId = form.dataset.claimFor || '';
    if (claimId) {
      /* "This is my lost pet" on a found report: add a claim to THAT report. No new lost report is created.
         The report only shows as Owner found once its finder confirms a claim. */
      const base = mergedReports().find(x => x.id === claimId && x.kind === 'found');
      if (!base) { err.textContent = 'That found report is no longer available.'; return; }
      if (isOwner(base)) { err.textContent = 'This is your own found report.'; return; }
      if (confirmedClaim(base)) { err.textContent = 'The finder already confirmed an owner for this pet.'; return; }
      const prev = form.dataset.updating ? myPendingClaim(base) : null;
      /* Saved in the database (POST/PUT /api/claims), so the finder of the found report sees it. */
      const btn = btnSubmit, label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Sending…';
      try { await sendClaim('claim', claimId, f, photos, prev); }
      catch (ex) { err.textContent = ex.message === 'Failed to fetch' ? 'Could not reach the server. Please try again.' : ex.message; return; }
      finally { btn.disabled = false; btn.textContent = label; }
      host.querySelector('.done h2').textContent = prev ? 'Lost report updated' : 'Lost report sent';
      host.querySelector('.done p').textContent = prev ? 'Your changes have been saved on the found report.' : "Thank you! The finder can now see your pet's details and will confirm if this is your pet.";
      host.querySelector('.done .actions a').href = 'report.html?id=' + encodeURIComponent(claimId);
      host.querySelector('.done .actions a').textContent = 'View the report';
      host.querySelector('.see-matches').hidden = true;   /* a response to someone else's report has nothing to match */
      document.querySelector('.type-pick').hidden = true; document.querySelector('.type-lead').hidden = true;
      form.hidden = true; host.querySelector('.done').hidden = false;
      host.querySelector('.match-banner')?.remove(); delete form.dataset.claimFor;
      window.scrollTo(0, 0);
      return;
    }
    let savedId;
    const saveBtn = btnSubmit, saveLabel = saveBtn.textContent;
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      /* Saved in the database (POST / PUT /api/reports). Nothing is stored in the browser. */
      savedId = String((editing ? await updateReport(editing, k, f, photos) : await createReport(k, f, photos)).id);
    } catch (ex) {
      const colorStepError = /color/i.test(ex.message || '');
      if (colorStepError) {
        const colorInput = form.querySelector('.step-about .pills[data-pills="color"] .pills-input');
        setFieldError(colorInput, true, ex.message);
        show(1, { scroll: false, keepErrors: true });
        focusField(colorInput);
      } else {
        err.textContent = ex.message || 'Could not save the report. Please try again.';
      }
      return;
    } finally { saveBtn.disabled = false; saveBtn.textContent = saveLabel; }
    host.querySelector('.done h2').textContent = editing ? 'Report updated' : 'Report filed';
    host.querySelector('.done p').textContent = editing ? 'Your changes have been saved.' : k === 'lost' ? 'Your lost pet report is now on the map.' : 'Thank you! Your found report is now on the map.';
    host.querySelector('.done .actions a').href = editing ? 'report.html?id=' + encodeURIComponent(editing.id) : 'dashboard.html';
    host.querySelector('.done .actions a').textContent = editing ? 'View report' : 'View on map';
    { const go = host.querySelector('.see-matches'); go.href = 'matching.html?report=' + encodeURIComponent(savedId); go.hidden = false; }
    document.querySelector('.type-pick').hidden = true; document.querySelector('.type-lead').hidden = true;
    form.hidden = true; host.querySelector('.done').hidden = false;
    host.querySelector('.match-banner')?.remove(); delete form.dataset.matchFor; delete form.dataset.claimFor; delete form.dataset.updating;
    window.scrollTo(0, 0);
  });

  new ResizeObserver(() => m.invalidateSize()).observe(host.querySelector('.pick'));
  m.invalidateSize();
  return { map: m, form, host };
}

/* Fills in and wires up the form that is already on the page (#view-lost or #view-found in add-report.html). */
function initReportForm(k) {
  const host = $('#view-' + k);
  if (typeof L === 'undefined') {
    host.innerHTML = '<p class="rempty">The map library failed to load. Check your internet connection.</p>';
    return null;
  }
  fillForm(k, host);
  return setupForm(k, host);
}

function setupAutoGrowTextareas(root = document) {
  root.querySelectorAll('.form textarea').forEach(textarea => {
    const resizeToContent = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };

    textarea.addEventListener('input', resizeToContent);

    // Set the correct height on load,
    // including any prefilled content.
    resizeToContent();
  });
}

setupAutoGrowTextareas();