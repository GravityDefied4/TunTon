/* =========================================================
   Profile page: details form, stats and "My reports".
   ========================================================= */

const myReports = () => read(REPORTS_KEY, []).filter(r => (r.owner || myId) === myId).sort((a, b) => b.created - a.created);

const pfForm = $('#profile-form');
pfForm.elements.brgy.insertAdjacentHTML('beforeend', BRGY.map(b => `<option>${b}</option>`).join(''));

function renderProfile() {
  const p = prof(), name = shownName(), mine = myReports();
  const since = read('tunton_users', {})[sess?.sub]?.created;
  $('#pf-name-big').textContent = name;
  $('#pf-email').textContent = sess?.email || 'Not logged in';
  $('#pf-since').textContent = since ? 'Member since ' + new Date(since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  const av = $('#pf-avatar');
  const picture = p.picture || sess?.picture || '';
  av.innerHTML = picture ? `<img src="${esc(picture)}" alt="Profile picture" referrerpolicy="no-referrer">` : esc(name[0].toUpperCase());
  pfForm.elements.dname.value = p.dname || sess?.given_name || sess?.name || '';
  pfForm.elements.facebook.value = p.facebook || '';
  pfForm.elements.messenger.value = p.messenger || '';
  pfForm.elements.phone.value = p.phone || '';
  pfForm.elements.brgy.value = p.brgy || '';
  $('#st-lost').textContent = mine.filter(r => r.kind === 'lost').length;
  $('#st-found').textContent = mine.filter(r => r.kind === 'found').length;
  $('#st-home').textContent = mine.filter(r => r.status === 'reunited').length;
  $('#rep-list').innerHTML = mine.length ? mine.map(r => `
    <li class="rep"><img src="${esc(r.photo)}" alt="">
      <div class="rep-body">
        <span class="badge ${r.status === 'reunited' || reportState(r) === 'found' ? 'badge--home' : r.kind === 'lost' ? 'badge--lost' : ''}">${r.status === 'reunited' ? '&#10003; Reunited' : reportState(r) === 'found' ? 'Pet found' : r.kind === 'lost' ? 'Lost' : 'Found'}</span>
        <h3>${esc(r.name || [speciesOf(r), r.color].filter(Boolean).join(' · '))}</h3>
        <p>${esc(r.brgy)} &middot; ${esc(ago(r.date))}</p>
        ${r.kind === 'lost' && r.status !== 'reunited' && findsOf(r).some(f => f.status === 'pending') && reportState(r) !== 'found' ? `<p class="rep-alert">🔔 ${findsOf(r).filter(f => f.status === 'pending').length} found report(s) to review</p>` : ''}
      </div>
      <div class="rep-actions" data-id="${esc(r.id)}">
        <a class="rep-view-link" href="report.html?id=${encodeURIComponent(r.id)}"><span class="rep-view-label">View report</span><span class="rep-view-arrow" aria-hidden="true">&rsaquo;</span></a>
      </div></li>`).join('') : '<li class="empty">You have not filed any reports yet.</li>';
}

/* Profile editing is transactional: changes remain in the form/preview until Save. */
const editButton = $('#pf-edit-button');
const cancelButton = $('#pf-cancel-button');
const editActions = $('#pf-edit-actions');
const cameraButton = $('#pf-camera-button');
const pictureNoteLabel = $('#pf-picture-note-label');
const editableFields = [pfForm.elements.dname, pfForm.elements.phone, pfForm.elements.brgy, pfForm.elements.facebook, pfForm.elements.messenger];
let editingProfile = false;
let draftPicture = undefined; // undefined = unchanged; '' = remove custom picture; data URL = replace
let originalForm = null;

function setProfileEditing(enabled) {
  editingProfile = enabled;
  $('#pf-note').classList.remove('error');
  editableFields.forEach(field => { field.disabled = !enabled; });
  editButton.hidden = enabled;
  $('#pf-display-name-field').hidden = !enabled;
  editActions.hidden = !enabled;
  pictureNote.hidden = !enabled;
  pictureNoteLabel.hidden = !enabled;
  cameraButton.hidden = !enabled;
  pfForm.classList.toggle('is-editing', enabled);
  $('#pf-profile-card').classList.toggle('is-editing', enabled);
  if (!enabled) {
    draftPicture = undefined;
    pictureInput.value = '';
    clearProfileErrors();
    renderProfile();
  } else {
    originalForm = {
      dname: pfForm.elements.dname.value,
      phone: pfForm.elements.phone.value,
      brgy: pfForm.elements.brgy.value,
      facebook: pfForm.elements.facebook.value,
      messenger: pfForm.elements.messenger.value
    };
    pictureNote.textContent = 'JPG or PNG · up to 2 MB';
    $('#pf-note').textContent = '';
  }
}

/* Validate each profile field with a clear reason shown right under it.
   Each rule returns '' when the value is fine, or a message saying what is wrong.
   `final` is false while typing (only definite mistakes are reported) and true on blur / Save. */
const SOCIAL = {
  facebook: { name: 'Facebook', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com', 'www.fb.com'], example: 'https://www.facebook.com/your.profile' },
  messenger: { name: 'Messenger', hosts: ['m.me', 'www.messenger.com', 'messenger.com'], example: 'https://m.me/your.username' }
};

function socialReason(kind, value, final) {
  const v = value.trim(), { name, hosts, example } = SOCIAL[kind];
  if (!v) return '';
  let url;
  try { url = new URL(v); } catch { return final ? `This is not a link. Start it with https://, for example ${example}.` : ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `The link must start with https://, for example ${example}.`;
  if (!hosts.includes(url.hostname.toLowerCase())) return final ? `This link goes to ${url.hostname}, not ${name}. Use your ${name} link, for example ${example}.` : '';
  if (!url.pathname.replace(/\//g, '')) return final ? `The link is missing your ${name} username after ${url.hostname}/.` : '';
  return '';
}

function phoneReason(value, final) {
  const v = value.trim();
  if (!v) return '';
  const bad = [...new Set(v.match(/[^\d\s+-]/g) || [])];
  if (bad.length) return `Phone numbers can only have digits, spaces and hyphens. Remove ${bad.map(c => '"' + c + '"').join(', ')}.`;
  if (/.\+/.test(v)) return 'The + sign can only be at the very start, as in +63 9XX XXX XXXX.';
  const digits = v.replace(/\D/g, '');
  const intl = v.startsWith('+') || digits.startsWith('63');
  if (!intl && digits.length >= 2 && !digits.startsWith('09')) return 'A Philippine mobile number starts with 09 or +63 9.';
  if (intl && digits.length >= 3 && !digits.startsWith('639')) return 'A Philippine mobile number starts with 09 or +63 9.';
  const expected = intl ? 12 : 11;
  if (digits.length > expected) return `That is ${digits.length} digits. A mobile number has ${expected} (${intl ? '+63 9XX XXX XXXX' : '09XX XXX XXXX'}).`;
  if (final && digits.length < expected) return `That is only ${digits.length} digits. A mobile number has ${expected} (${intl ? '+63 9XX XXX XXXX' : '09XX XXX XXXX'}).`;
  return '';
}

const profileValidationRules = {
  dname: value => {
    const n = value.trim().length;
    if (n > 60) return 'Display name can be at most 60 characters.';
    return n < 2 ? 'Display name needs at least 2 characters.' : '';
  },
  phone: phoneReason,
  facebook: (value, final) => socialReason('facebook', value, final),
  messenger: (value, final) => socialReason('messenger', value, final)
};

/* Shows (or clears) the reason under the field. Returns true when the value is valid. */
function validateProfileField(field, final = true) {
  const rule = profileValidationRules[field.name];
  if (!rule || field.disabled) return true;
  const reason = rule(field.value, final);
  const box = $('#pf-error-' + field.name);
  field.setCustomValidity(reason);
  field.setAttribute('aria-invalid', String(!!reason));
  if (reason) field.setAttribute('aria-describedby', box.id); else field.removeAttribute('aria-describedby');
  box.textContent = reason;
  box.hidden = !reason;
  return !reason;
}

function clearProfileErrors() {
  editableFields.forEach(field => {
    field.setCustomValidity('');
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    const box = $('#pf-error-' + field.name);
    if (box) { box.textContent = ''; box.hidden = true; }
  });
}

for (const field of editableFields) {
  field.addEventListener('input', () => validateProfileField(field, false));
  field.addEventListener('blur', () => { if (!field.disabled && editingProfile) validateProfileField(field, true); });
  field.addEventListener('change', () => validateProfileField(field, true));
}

pfForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!editingProfile) return;
  $('#pf-note').classList.remove('error');
  const results = editableFields.map(field => validateProfileField(field, true));   // checks every field so all problems show at once
  if (results.includes(false)) {
    $('#pf-note').textContent = 'Please fix the highlighted fields.';
    $('#pf-note').classList.add('error');
    editableFields[results.indexOf(false)].focus();
    return;
  }
  const f = new FormData(pfForm);
  const current = prof();
  const next = {
    ...current,
    dname: String(f.get('dname') || '').trim() || (sess?.given_name || sess?.name || 'Guest'),
    phone: String(f.get('phone') || '').trim(),
    brgy: String(f.get('brgy') || ''),
    facebook: String(f.get('facebook') || '').trim(),
    messenger: String(f.get('messenger') || '').trim()
  };
  if (draftPicture !== undefined) {
    if (draftPicture) next.picture = draftPicture;
    else delete next.picture;
  }
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  } catch {
    $('#pf-note').textContent = 'Could not save your profile. Try a smaller photo.';
    return;
  }
  applyIdentity();
  renderProfile();
  syncProfilePicture(next.picture || '');
  $('#pf-note').textContent = 'Profile changes saved.';
  setProfileEditing(false);
  $('#pf-note').textContent = 'Profile changes saved.';
});

editButton.addEventListener('click', () => setProfileEditing(true));
cancelButton.addEventListener('click', () => {
  if (originalForm) {
    pfForm.elements.dname.value = originalForm.dname;
    pfForm.elements.phone.value = originalForm.phone;
    pfForm.elements.brgy.value = originalForm.brgy;
    pfForm.elements.facebook.value = originalForm.facebook;
    pfForm.elements.messenger.value = originalForm.messenger;
  }
  setProfileEditing(false);
  $('#pf-note').textContent = 'Changes discarded.';
});

/* Photo selection only updates the preview; Save changes commits it. */
const pictureInput = $('#pf-picture-input');
const pictureNote = $('#pf-picture-note');
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;

pictureInput.addEventListener('change', () => {
  const file = pictureInput.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    pictureNote.textContent = 'Choose a JPG or PNG image.';
    pictureInput.value = '';
    return;
  }
  if (file.size > MAX_PICTURE_BYTES) {
    pictureNote.textContent = 'Image is too large. Choose a file under 2 MB.';
    pictureInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSide = 320;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      draftPicture = canvas.toDataURL('image/jpeg', 0.82);
      const av = $('#pf-avatar');
      av.innerHTML = `<img src="${esc(draftPicture)}" alt="Profile picture preview">`;
      pictureNote.textContent = 'Photo preview ready. Save changes to keep it.';
      pictureInput.value = '';
    };
    image.onerror = () => { pictureNote.textContent = 'Could not read that image. Try another.'; };
    image.src = reader.result;
  };
  reader.onerror = () => { pictureNote.textContent = 'Could not read that image. Try another.'; };
  reader.readAsDataURL(file);
});

function syncProfilePicture(picture) {
  const avatar = $('#user-avatar');
  const initial = $('#user-initial');
  if (!avatar || !initial) return;
  const fallback = sess?.picture || '';
  if (picture || fallback) {
    avatar.src = picture || fallback;
    avatar.hidden = false;
    initial.hidden = true;
  } else {
    avatar.removeAttribute('src');
    avatar.hidden = true;
    initial.hidden = false;
  }
}


renderProfile();
