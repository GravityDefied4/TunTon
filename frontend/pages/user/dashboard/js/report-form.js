/* =========================================================
   Lost / found report form, shared by add-report.html.
   add-report.js calls initReportForm('lost') or initReportForm('found') when that form is first shown.
   ========================================================= */

/* The form markup lives in add-report.html (#view-lost and #view-found). This only fills in what depends on the user or the day:
   barangay list, saved barangay, today's date, contact, and the "other animal" suggestions. */
function fillForm(k, host) {
  const form = host.querySelector('form');
  form.elements.brgy.insertAdjacentHTML('beforeend', BRGY.map(b => `<option${b === prof().brgy ? ' selected' : ''}>${b}</option>`).join(''));
  /* defaultValue (not .value) so "File another" / form.reset() brings these back */
  form.elements.date.defaultValue = form.elements.date.value = form.elements.date.max = today;
  form.elements.contact.defaultValue = form.elements.contact.value = prof().phone || sess?.email || '';
  form.querySelector('#' + k + '-otherspecies-list').innerHTML = OTHER_ANIMALS.map(a => `<option value="${a}"></option>`).join('');
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
function setupPills(form) {
  const MAX = 8;
  form.querySelectorAll('.pills').forEach(box => {
    const input = box.querySelector('.pills-input'), hidden = form.elements[box.dataset.pills];
    let list = [];
    const draw = () => {
      box.querySelectorAll('.pill').forEach(p => p.remove());
      list.forEach((t, i) => input.insertAdjacentHTML('beforebegin', `<span class="pill">${esc(t)}<button type="button" data-i="${i}" aria-label="Remove ${esc(t)}">&times;</button></span>`));
      hidden.value = list.join(', ');
    };
    const add = raw => {
      const t = raw.trim().replace(/^[,;]+|[,;]+$/g, '');
      if (t && list.length < MAX && !list.some(x => x.toLowerCase() === t.toLowerCase())) list.push(t);
    };
    const commit = () => { add(input.value); input.value = ''; draw(); };
    const sep = box.dataset.sep === 'comma' ? /[,;]/ : /[\s,;]/;
    const sepEnd = new RegExp(sep.source + '$'), sepSplit = new RegExp(sep.source + '+');
    input.addEventListener('input', e => {
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
      clear() { list = []; input.value = ''; draw(); },
      set(str) {   // "White and brown" -> white, brown (breed keeps spaces: "Shih Tzu")
        list = []; input.value = '';
        const parts = (/[,;]/.test(str) || box.dataset.sep === 'comma') ? str.split(/[,;]+/) : str.split(/\s+/);
        parts.filter(w => !/^(and|&)$/i.test(w.trim())).forEach(add); draw();
      }
    };
  });
}

function setupForm(k, host) {
  const form = host.querySelector('form'), err = host.querySelector('.err');
  const m = L.map(host.querySelector('.pick')).setView(DAGUPAN, 15);
  tiles(m);
  lockToDagupan(m);
  setupPills(form);

  /* Species drives the form: "Other" asks for the animal, and the breed box only works once a species is chosen,
     with suggestions that match that species. */
  const otherBox = form.querySelector('.other-species'), otherInput = form.elements.otherSpecies;
  const breedBox = form.querySelector('.pills[data-pills="breed"]'), breedInput = breedBox.querySelector('.pills-input');
  const breedList = form.querySelector('#' + k + '-breed-list');
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
    breedInput.placeholder = !sp ? 'Choose a species first' : other ? 'Breed or variety, if you know it' : 'e.g. ' + (sp === 'Dog' ? 'Shih Tzu' : 'Persian');
    fillBreeds();
  };
  form.syncSpecies = syncSpecies;
  form.querySelectorAll('input[name="species"]').forEach(r => r.addEventListener('change', () => {
    breedBox.pills.clear();                  // a breed from the old species no longer applies
    syncSpecies();
    if (species() === 'Other') otherInput.focus();
  }));
  otherInput.addEventListener('input', fillBreeds);
  form.addEventListener('reset', () => setTimeout(syncSpecies));
  syncSpecies();

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
    if (!inDagupan(ll.lat, ll.lng)) { err.textContent = OUTSIDE; return; }
    if (err.textContent === OUTSIDE) err.textContent = '';
    if (!pin) { pin = L.marker(ll, { draggable: true, icon: pinIcon(k) }).addTo(m); pin.on('drag', draw);
      /* A pin dragged out of the city snaps back to its last valid spot. */
      pin.on('dragend', () => { const at = pin.getLatLng(); if (inDagupan(at.lat, at.lng)) lastOk = at; else { pin.setLatLng(lastOk); draw(); err.textContent = OUTSIDE; } }); }
    else pin.setLatLng(ll);
    lastOk = pin.getLatLng(); draw(); if (pan) m.setView(ll, 16);
  };
  if (claimTarget) m.setView([claimTarget.lat, claimTarget.lng], 16);
  m.on('click', e => put(e.latlng));
  zone?.addEventListener('change', () => pin && draw());
  host.querySelector('.locate-pin').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(p => put(L.latLng(p.coords.latitude, p.coords.longitude), true), () => { err.textContent = 'Could not get your location. Tap the map instead.'; });
  });

  /* Photos: several allowed, listed by file name. Click a name to preview it. */
  const MAX_PHOTOS = 5;
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
      ? `${photos.length} of ${MAX_PHOTOS} photo${photos.length === 1 ? '' : 's'} selected${photos.length === 1 ? ' · Add more if helpful' : ''}`
      : 'No photos selected yet';
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
    err.textContent = '';
    const picked = [...input.files].filter(f => f.type.startsWith('image/'));
    input.value = '';   // so the same file can be picked again later
    for (const f of picked) {
      if (photos.length >= MAX_PHOTOS) { err.textContent = `You can add up to ${MAX_PHOTOS} photos.`; break; }
      if (photos.some(p => p.name === f.name && p.size === f.size)) continue;
      try { photos.push({ name: f.name, size: f.size, data: await shrink(f) }); }
      catch { err.textContent = `Could not read "${f.name}". Try a JPG or PNG.`; }
    }
    drawFiles();
  });
  fileList.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const i = +b.dataset.i;
    if (b.classList.contains('file-remove')) { photos.splice(i, 1); err.textContent = ''; drawFiles(); }
    else previewPhoto(photos[i].name, photos[i].data);
  });

  /* ---------- Edit mode: add-report.html?edit=<id> (owner only) ---------- */
  const editId = new URLSearchParams(location.search).get('edit');
  const editing = editId ? read(REPORTS_KEY, []).find(x => x.id === editId && x.owner === myId && x.kind === k) : null;
  if (editId && !editing) {
    const note = document.createElement('p');
    note.className = 'match-banner';
    note.textContent = 'This report could not be found, or it is not yours to edit.';
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
    set('name', r.name); set('size', r.size); set('markings', r.markings);
    set('description', r.description); set('howfound', r.howFound); set('where', r.where);
    set('brgy', r.brgy); set('date', r.date); set('zone', r.zone || ''); set('contact', r.contact); set('facebook', r.facebook || '');
    if ('breed' in r) breedBox.pills.set(r.breed || '');
    if ('color' in r) form.querySelector('.pills[data-pills="color"]').pills.set(r.color || '');
    photos = (r.photos && r.photos.length ? r.photos : [r.photo]).filter(Boolean).map((d, i) => ({ name: 'Photo ' + (i + 1), size: Math.round(d.length * .75), data: d }));
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
    host.querySelector('.again')?.remove();
    document.title = 'Edit report | TunTon';
    document.querySelectorAll('.view-head h1').forEach(h => { h.textContent = 'Edit your ' + k + ' report'; });
  }

  if (claimEdit) {
    fillFrom(claimEdit);
    form.dataset.updating = '1';
    form.querySelector('button[type="submit"]').textContent = 'Save changes';
    host.querySelector('.again')?.remove();
    document.title = 'Edit lost report | TunTon';
    document.querySelectorAll('.view-head h1').forEach(h => { h.textContent = 'Edit your lost report'; });
  }


  /* ---------- Step-by-step wizard (like Google Forms): one step at a time, Back / Next, progress bar ---------- */
  const steps = [...form.querySelectorAll('.step')];
  const btnBack = form.querySelector('.wiz-back'), btnNext = form.querySelector('.wiz-next'), btnSubmit = form.querySelector('.wiz-submit');
  const stepNames = steps.map(s => s.querySelector('h2').textContent);
  const progress = document.createElement('nav');
  progress.className = 'wizard-progress';
  progress.setAttribute('aria-label', 'Form progress');
  progress.innerHTML = `<div class="wp-bar" aria-hidden="true"><span></span></div><ol class="wp-dots">${steps.map((_, i) =>
    `<li><button type="button" class="wp-dot" data-i="${i}" aria-label="Go to step ${i + 1}: ${esc(stepNames[i])}"><b>${i + 1}</b><span>${esc(stepNames[i])}</span></button></li>`).join('')}</ol>`;
  form.insertBefore(progress, form.firstChild);
  let cur = 0;

  const labelOf = el => (el.id && form.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || 'this field';

  /* Returns { msg, el } for the first problem in step i, or null when the step is complete. */
  const stepError = i => {
    const s = steps[i];
    s.querySelectorAll('.pills').forEach(b => b.pills.commit());
    if (s.contains(form.elements.photo) && !photos.length) return { msg: 'Please add at least one photo of the pet.', el: s.querySelector('.drop input') };
    if (s.querySelector('input[name="species"]')) {
      if (!species()) return { msg: 'Please choose a species.', el: s.querySelector('input[name="species"]') };
      if (species() === 'Other' && !otherInput.value.trim()) return { msg: 'Please tell us what kind of animal it is.', el: otherInput };
      if (!form.elements.color.value) return { msg: 'Please add the main color (type a color and press the space bar).', el: s.querySelector('.pills[data-pills="color"] input') };
      if (!form.querySelector('input[name="size"]:checked')) return { msg: 'Please choose a size.', el: s.querySelector('input[name="size"]') };
    }
    for (const el of s.querySelectorAll('input:not([type=radio]):not([type=hidden]):not([type=file]):not(.pills-input), select, textarea')) {
      if (el.disabled) continue;
      if (el.required && !el.value.trim()) return { msg: `Please fill in “${labelOf(el)}”.`, el };
      if (!el.checkValidity()) return { msg: el.validationMessage || `Please check “${labelOf(el)}”.`, el };
    }
    if (s.contains(form.elements.lat) && !pin) return { msg: 'Please drop a pin on the map.', el: null };
    return null;
  };

  const show = (i, { scroll = true } = {}) => {
    cur = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((s, n) => { s.hidden = n !== cur; });
    btnBack.hidden = cur === 0;
    btnNext.hidden = cur === steps.length - 1;
    btnSubmit.hidden = cur !== steps.length - 1;
    progress.querySelector('.wp-bar span').style.width = ((cur + 1) / steps.length * 100) + '%';
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
      if (bad) { show(i); err.textContent = bad.msg; bad.el?.focus(); return false; }
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

  form.addEventListener('submit', e => {
    e.preventDefault(); err.textContent = '';
    /* Enter pressed in the middle of the form: treat it as "Next" instead of submitting */
    if (cur < steps.length - 1) { goTo(cur + 1); return; }
    /* Last step: check every step once more and jump back to the first one that is incomplete */
    for (let i = 0; i < steps.length; i++) {
      const bad = stepError(i);
      if (bad) { show(i); err.textContent = bad.msg; bad.el?.focus(); return; }
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
      const find = { id: prev ? prev.id : 'f' + Date.now(), by: myId, founderName: shownName(), status: 'pending', contact: f.get('contact'), facebook: (f.get('facebook') || '').trim(), where: f.get('where') || '', brgy: f.get('brgy'), date: f.get('date'), lat: +f.get('lat'), lng: +f.get('lng'), markings: f.get('markings'), howFound: f.get('howfound') || '', photos: photos.map(p => p.data), at: prev ? prev.at : Date.now(), ...(prev ? { editedAt: Date.now() } : {}) };
      const { found: _old, ...rest } = base;
      /* one open find per person: sending again replaces your earlier one that is still waiting */
      const finds = findsOf(base).filter(x => !(x.by === myId && x.status === 'pending')).concat(find);
      try { saveReport({ ...rest, owner: base.owner || (SAMPLES.some(s => s.id === matchId) ? 'sample' : base.owner), finds }); }
      catch { err.textContent = 'Could not save this (browser storage is full).'; return; }
      host.querySelector('.done h2').textContent = prev ? 'Found report updated' : 'Found report sent';
      host.querySelector('.done p').textContent = prev ? 'Your changes have been saved on the lost report.' : 'Thank you! The owner of the lost report can now see your details and will confirm if this is their pet.';
      host.querySelector('.done .actions a').href = 'report.html?id=' + encodeURIComponent(matchId);
      host.querySelector('.done .actions a').textContent = 'View the report';
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
      const claim = { id: prev ? prev.id : 'c' + Date.now(), by: myId, ownerName: shownName(), status: 'pending', species: f.get('species'), otherSpecies: (f.get('otherSpecies') || '').trim(), name: f.get('name') || '', breed: f.get('breed'), color: f.get('color'), size: f.get('size'), markings: f.get('markings'), description: f.get('description') || '', brgy: f.get('brgy'), date: f.get('date'), zone: +f.get('zone') || 0, contact: f.get('contact'), facebook: (f.get('facebook') || '').trim(), lat: +f.get('lat'), lng: +f.get('lng'), photos: photos.map(p => p.data), at: prev ? prev.at : Date.now(), ...(prev ? { editedAt: Date.now() } : {}) };
      /* one open claim per person: sending again replaces your earlier one that is still waiting */
      const claims = claimsOf(base).filter(x => !(x.by === myId && x.status === 'pending')).concat(claim);
      try { saveReport({ ...base, owner: base.owner || (SAMPLES.some(s => s.id === claimId) ? 'sample' : base.owner), claims }); }
      catch { err.textContent = 'Could not save this (browser storage is full).'; return; }
      host.querySelector('.done h2').textContent = prev ? 'Lost report updated' : 'Lost report sent';
      host.querySelector('.done p').textContent = prev ? 'Your changes have been saved on the found report.' : "Thank you! The finder can now see your pet's details and will confirm if this is your pet.";
      host.querySelector('.done .actions a').href = 'report.html?id=' + encodeURIComponent(claimId);
      host.querySelector('.done .actions a').textContent = 'View the report';
      form.hidden = true; host.querySelector('.done').hidden = false;
      host.querySelector('.match-banner')?.remove(); delete form.dataset.claimFor;
      window.scrollTo(0, 0);
      return;
    }
    host.querySelector('.done h2').textContent = editing ? 'Report updated' : 'Report filed';
    host.querySelector('.done p').textContent = editing ? 'Your changes have been saved.' : k === 'lost' ? 'Your lost pet report is now on the map.' : 'Thank you! Your found report is now on the map.';
    host.querySelector('.done .actions a').href = editing ? 'report.html?id=' + encodeURIComponent(editing.id) : 'dashboard.html';
    host.querySelector('.done .actions a').textContent = editing ? 'View report' : 'View on map';
    const r = { id: 'u' + Date.now(), kind: k, species: f.get('species'), otherSpecies: (f.get('otherSpecies') || '').trim(), size: f.get('size'), name: f.get('name') || '', breed: f.get('breed'), color: f.get('color'), markings: f.get('markings'), description: f.get('description') || '', howFound: f.get('howfound') || '', brgy: f.get('brgy'), date: f.get('date'), contact: f.get('contact'), facebook: (f.get('facebook') || '').trim(), zone: +f.get('zone') || 0, where: f.get('where') || '', lat: +f.get('lat'), lng: +f.get('lng'), photo: photos[0].data, photos: photos.map(p => p.data), created: Date.now(), owner: myId, ownerName: shownName(), status: 'active', matchFor: form.dataset.matchFor || '' };
    try {
      if (editing) saveReport({ ...editing, ...r, id: editing.id, owner: editing.owner, ownerName: editing.ownerName, created: editing.created, status: editing.status, finds: editing.finds, claims: editing.claims, found: editing.found, matchFor: editing.matchFor });
      else localStorage.setItem(REPORTS_KEY, JSON.stringify(read(REPORTS_KEY, []).concat(r)));
    }
    catch { err.textContent = 'Could not save this report (browser storage is full).'; return; }
    form.hidden = true; host.querySelector('.done').hidden = false;
    host.querySelector('.match-banner')?.remove(); delete form.dataset.matchFor; delete form.dataset.claimFor; delete form.dataset.updating;
    window.scrollTo(0, 0);
  });

  host.querySelector('.again')?.addEventListener('click', () => {
    form.reset(); photos = []; drawFiles(); err.textContent = '';
    if (pin) { m.removeLayer(pin); pin = null; } if (circle) { m.removeLayer(circle); circle = null; }
    form.hidden = false; host.querySelector('.done').hidden = true;
    host.querySelector('.match-banner')?.remove(); delete form.dataset.matchFor; delete form.dataset.claimFor; delete form.dataset.updating;
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