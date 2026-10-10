/* =========================================================
   Lost / found report form, shared by lost.html and found.html.
   Each page calls initReportForm('lost') or initReportForm('found').
   ========================================================= */

const chips = (name, opts) => `<div class="chips">${opts.map(o => `<label><input type="radio" name="${name}" value="${o}" required><span>${o}</span></label>`).join('')}</div>`;

function formHTML(k) {
  const L_ = k === 'lost';
  return `
  <div class="view-head"><h1>${L_ ? 'File a lost pet report' : 'File a found pet report'}</h1>
    <p>${L_ ? 'Tell us about your pet and where it was last seen. We will compare it with found reports nearby.' : 'Found a pet that might belong to someone? Describe it and drop a pin where you found it.'}</p></div>
  <div class="box"><form class="form" novalidate>
    <label class="drop full"><b>Add clear photos of the pet</b><span class="hint">Tap to upload (JPG or PNG). You can add up to 5 photos; the first is the main photo.</span>
      <input type="file" name="photo" accept="image/*" multiple></label>
    <ul class="files full" aria-label="Uploaded photos"></ul>
    <fieldset class="full"><legend>Species</legend>${chips('species', ['Dog', 'Cat', 'Other'])}</fieldset>
    ${L_ ? '<div><label for="' + k + '-name">Pet\'s name</label><input type="text" id="' + k + '-name" name="name" maxlength="40"></div>' : ''}
    <div><label for="${k}-breed">Breed</label><input type="text" id="${k}-breed" name="breed" maxlength="40" placeholder="Unknown or mixed is fine"></div>
    <div><label for="${k}-color">Main color</label><input type="text" id="${k}-color" name="color" maxlength="40" required></div>
    <fieldset><legend>Size</legend>${chips('size', ['Small', 'Medium', 'Large'])}</fieldset>
    <div class="full"><label for="${k}-marks">Markings and other details</label><textarea id="${k}-marks" name="markings" rows="3" maxlength="300" placeholder="Collar, scars, spots, behavior&hellip;"></textarea></div>
    <div><label for="${k}-brgy">Barangay</label><select id="${k}-brgy" name="brgy" required><option value="">Select&hellip;</option>${BRGY.map(b => `<option${b === prof().brgy ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
    <div><label for="${k}-date">${L_ ? 'Date last seen' : 'Date found'}</label><input type="date" id="${k}-date" name="date" value="${today}" max="${today}" required></div>
    ${L_ ? `<div><label for="lost-zone">Search zone (geofence)</label><select id="lost-zone" name="zone"><option value="500">500 m</option><option value="1000" selected>1 km</option><option value="2000">2 km</option><option value="5000">5 km</option></select></div>`
         : `<div><label for="found-where">Where is the pet now?</label><select id="found-where" name="where"><option>With me</option><option>At a shelter or vet</option><option>Left where I found it</option></select></div>`}
    <div><label for="${k}-contact">Contact (phone or email)</label><input type="text" id="${k}-contact" name="contact" maxlength="80" required value="${esc(prof().phone || sess?.email || '')}"></div>
    <div class="full"><label>${L_ ? 'Where was it last seen?' : 'Where did you find it?'}</label>
      <div class="pick"></div>
      <p class="hint pick-hint">Tap the map to drop a pin${L_ ? '. The red circle is your search zone' : ''}, or <button type="button" class="btn btn-small locate-pin">use my current location</button></p>
      <input type="hidden" name="lat"><input type="hidden" name="lng"></div>
    <p class="form-note error full err" role="alert"></p>
    <div class="full"><button type="submit" class="btn btn-sun">${L_ ? 'Submit lost report' : 'Submit found report'}</button></div>
  </form>
  <div class="done" hidden><h2>Report filed</h2><p style="margin-inline:auto">${L_ ? 'Your lost pet report is now on the map.' : 'Thank you! Your found report is now on the map.'}</p>
    <div class="actions"><a href="dashboard.html" class="btn btn-sun">View on map</a><button type="button" class="btn btn-small again">File another</button></div></div></div>`;
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

function setupForm(k, host) {
  const form = host.querySelector('form'), err = host.querySelector('.err');
  const m = L.map(host.querySelector('.pick')).setView(DAGUPAN, 15);
  tiles(m);
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
  const drawFiles = () => {
    fileList.innerHTML = photos.map((p, i) => `
      <li class="file">
        <button type="button" class="file-open" data-i="${i}" title="Preview ${esc(p.name)}">
          <span aria-hidden="true">🖼️</span><span class="file-name">${esc(p.name)}</span><span class="file-size">${kb(p.size)}</span>
        </button>
        ${i === 0 ? '<span class="file-main">Main photo</span>' : ''}
        <button type="button" class="file-remove" data-i="${i}" aria-label="Remove ${esc(p.name)}">&times;</button>
      </li>`).join('');
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
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (!photos.length) { err.textContent = 'Please add at least one photo of the pet.'; return; }
    if (!pin) { err.textContent = 'Please drop a pin on the map.'; return; }
    const f = new FormData(form);
    const r = { id: 'u' + Date.now(), kind: k, species: f.get('species'), size: f.get('size'), name: f.get('name') || '', breed: f.get('breed'), color: f.get('color'), markings: f.get('markings'), brgy: f.get('brgy'), date: f.get('date'), contact: f.get('contact'), lat: +f.get('lat'), lng: +f.get('lng'), photo: photos[0].data, photos: photos.map(p => p.data), created: Date.now(), owner: myId, status: 'active', matchFor: form.dataset.matchFor || '' };
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

/* Builds the form inside #view-lost or #view-found and wires it up. */
function initReportForm(k) {
  const host = $('#view-' + k);
  if (typeof L === 'undefined') {
    host.innerHTML = '<p class="rempty">The map library failed to load. Check your internet connection.</p>';
    return null;
  }
  host.innerHTML = formHTML(k);
  return setupForm(k, host);
}