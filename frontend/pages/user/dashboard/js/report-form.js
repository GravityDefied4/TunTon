/* =========================================================
   Lost / found report form, shared by lost.html and found.html.
   Each page calls initReportForm('lost') or initReportForm('found').
   ========================================================= */

/* The form markup lives in lost.html and found.html. This only fills in what depends on the user or the day:
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

  // A user who recognizes a found-pet report can start a lost report with pet details prefilled.
  // The user must still confirm the missing date/location and upload a photo before submitting.
  if (k === 'lost') {
    const claimId = new URLSearchParams(location.search).get('claim');
    if (claimId) {
      const foundReport = mergedReports().find(r => String(r.id) === claimId && r.kind === 'found');
      if (foundReport) {
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
        banner.textContent = 'You are reporting that this found pet is yours and is missing. Confirm the details, choose when and where your pet was last seen, upload a photo, and drop a pin before submitting.';
        form.parentElement.insertBefore(banner, form);
      }
    }
  }

  const zone = form.elements.zone;
  let pin = null, circle = null;
  const draw = () => {
    const ll = pin.getLatLng();
    form.elements.lat.value = ll.lat; form.elements.lng.value = ll.lng;
    if (zone) { if (circle) circle.setLatLng(ll).setRadius(+zone.value); else circle = L.circle(ll, { radius: +zone.value, color: '#d93636', weight: 2, fillOpacity: .1, interactive: false }).addTo(m); }
  };
  const put = (ll, pan) => {
    if (!pin) { pin = L.marker(ll, { draggable: true, icon: pinIcon(k) }).addTo(m); pin.on('drag', draw); }
    else pin.setLatLng(ll);
    draw(); if (pan) m.setView(ll, 16);
  };
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

  form.addEventListener('submit', e => {
    e.preventDefault(); err.textContent = '';
    form.querySelectorAll('.pills').forEach(b => b.pills.commit());
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (species() === 'Other' && !otherInput.value.trim()) { err.textContent = 'Please tell us what kind of animal it is.'; otherInput.focus(); return; }
    if (!form.elements.color.value) { err.textContent = 'Please add the main color (type a color and press the space bar).'; form.querySelector('.pills[data-pills="color"] input').focus(); return; }
    if (!photos.length) { err.textContent = 'Please add at least one photo of the pet.'; return; }
    if (!pin) { err.textContent = 'Please drop a pin on the map.'; return; }
    const f = new FormData(form);
    const matchId = form.dataset.matchFor || '';
    if (matchId) {
      /* "I found this pet" on a lost report: add a find to THAT report. No new found report is created.
         The report only shows as found once its owner confirms a find. */
      const base = mergedReports().find(x => x.id === matchId);
      if (!base) { err.textContent = 'That lost report is no longer available.'; return; }
      if (isOwner(base)) { err.textContent = 'This is your own lost report.'; return; }
      const find = { id: 'f' + Date.now(), by: myId, founderName: shownName(), status: 'pending', contact: f.get('contact'), where: f.get('where') || '', brgy: f.get('brgy'), date: f.get('date'), lat: +f.get('lat'), lng: +f.get('lng'), markings: f.get('markings'), howFound: f.get('howfound') || '', photos: photos.map(p => p.data), at: Date.now() };
      const { found: _old, ...rest } = base;
      /* one open find per person: sending again replaces your earlier one that is still waiting */
      const finds = findsOf(base).filter(x => !(x.by === myId && x.status === 'pending')).concat(find);
      try { saveReport({ ...rest, owner: base.owner || (SAMPLES.some(s => s.id === matchId) ? 'sample' : base.owner), finds }); }
      catch { err.textContent = 'Could not save this (browser storage is full).'; return; }
      host.querySelector('.done h2').textContent = 'Found report sent';
      host.querySelector('.done p').textContent = 'Thank you! The owner of the lost report can now see your details and will confirm if this is their pet.';
      host.querySelector('.done .actions a').href = 'report.html?id=' + encodeURIComponent(matchId);
      host.querySelector('.done .actions a').textContent = 'View the report';
      form.hidden = true; host.querySelector('.done').hidden = false;
      host.querySelector('.match-banner')?.remove(); delete form.dataset.matchFor;
      window.scrollTo(0, 0);
      return;
    }
    host.querySelector('.done h2').textContent = 'Report filed';
    host.querySelector('.done p').textContent = k === 'lost' ? 'Your lost pet report is now on the map.' : 'Thank you! Your found report is now on the map.';
    host.querySelector('.done .actions a').href = 'dashboard.html';
    host.querySelector('.done .actions a').textContent = 'View on map';
    const r = { id: 'u' + Date.now(), kind: k, species: f.get('species'), otherSpecies: (f.get('otherSpecies') || '').trim(), size: f.get('size'), name: f.get('name') || '', breed: f.get('breed'), color: f.get('color'), markings: f.get('markings'), description: f.get('description') || '', howFound: f.get('howfound') || '', brgy: f.get('brgy'), date: f.get('date'), contact: f.get('contact'), zone: +f.get('zone') || 0, where: f.get('where') || '', lat: +f.get('lat'), lng: +f.get('lng'), photo: photos[0].data, photos: photos.map(p => p.data), created: Date.now(), owner: myId, ownerName: shownName(), status: 'active', matchFor: form.dataset.matchFor || '' };
    try { localStorage.setItem(REPORTS_KEY, JSON.stringify(read(REPORTS_KEY, []).concat(r))); }
    catch { err.textContent = 'Could not save this report (browser storage is full).'; return; }
    form.hidden = true; host.querySelector('.done').hidden = false;
    host.querySelector('.match-banner')?.remove(); delete form.dataset.matchFor;
    window.scrollTo(0, 0);
  });

  host.querySelector('.again').addEventListener('click', () => {
    form.reset(); photos = []; drawFiles(); err.textContent = '';
    if (pin) { m.removeLayer(pin); pin = null; } if (circle) { m.removeLayer(circle); circle = null; }
    form.hidden = false; host.querySelector('.done').hidden = true;
    host.querySelector('.match-banner')?.remove(); delete form.dataset.matchFor;
  });

  new ResizeObserver(() => m.invalidateSize()).observe(host.querySelector('.pick'));
  m.invalidateSize();
  return { map: m, form, host };
}

/* Fills in and wires up the form that is already on the page (#view-lost or #view-found). */
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