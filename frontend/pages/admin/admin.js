/* TunTon Admin Dashboard — uses the authenticated /api/admin endpoints. */
const API = window.TUNTON?.API_BASE ?? '/api';
const HOME = '../../index.html';
const SESSION_KEY = 'tunton_session';
const LIMIT = 20;
const EP = {
  stats: '/admin/stats',
  users: '/admin/users',
  userStatus: id => `/admin/users/${id}/status`,
  reports: '/admin/reports',
  reportDetail: id => `/admin/reports/${id}`,
  flagReport: id => `/admin/reports/${id}/flag`,
  removeReport: id => `/admin/reports/${id}/remove`,
  restoreReport: id => `/admin/reports/${id}/restore`,
  reportClaims: id => `/admin/reports/${id}/claims`,
  claims: '/admin/claims',
  logs: '/admin/logs',
  me: '/auth/me' // optional: used to refresh the profile; falls back to the login session if unavailable
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return ''; };
const label = s => String(s ?? '').replace(/[_\.]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const date = d => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const datetime = d => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const rowsOf = d => Array.isArray(d) ? d : (d?.items || d?.rows || []);
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const state = { users: { offset: 0, total: 0 }, reports: { offset: 0, total: 0 }, claims: { offset: 0, total: 0 }, logs: { offset: 0, total: 0 }, seq: {} };
const nextSeq = key => state.seq[key] = (state.seq[key] || 0) + 1;

const session = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!s?.token) return null;
    const payload = JSON.parse(atob(s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    /* The role comes from the signed token, not from the editable copy in localStorage. */
    return payload.exp * 1000 > Date.now() ? { ...s, role: payload.role, payload } : null;
  } catch { return null; }
})();
function logout() { localStorage.removeItem(SESSION_KEY); location.replace(HOME); }
const USER_DASHBOARD = '../user/user.html';
if (!session) logout();
else if (session.role !== 'admin') location.replace(USER_DASHBOARD);   // regular users only use the user dashboard

async function api(path, { method = 'GET', query = {}, body } = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  const response = await fetch(API + path + (qs.size ? `?${qs}` : ''), {
    method,
    headers: { Authorization: `Bearer ${session.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 401) { logout(); throw new Error('Your session has expired.'); }
  let json = {};
  try { json = await response.json(); } catch { }
  if (response.status === 403) throw new Error('You are not allowed to access this admin feature.');
  if (!response.ok || json.success === false) throw new Error(json.message || 'Request failed. Please try again.');
  return json.data ?? json;
}
function error(message) { const el = $('#error'); el.hidden = !message; el.textContent = message || ''; }
function fail(e) { error(e?.message || 'Could not connect to the TunTon server.'); }
function setLoading(id, cols, text = 'Loading…') { $(id).innerHTML = `<tr><td colspan="${cols}" class="a-empty">${esc(text)}</td></tr>`; }
function empty(cols, text) { return `<tr><td colspan="${cols}" class="a-empty">${esc(text)}</td></tr>`; }
function badge(value) {
  const v = String(value || 'unknown').toLowerCase();
  const cls = ['active', 'approved', 'visible', 'confirmed'].includes(v) ? 'is-good' :
    ['suspended', 'rejected', 'removed', 'hidden', 'closed'].includes(v) ? 'is-bad' :
      ['pending', 'pending_proof', 'under_review', 'claim_pending', 'matched'].includes(v) ? 'is-warn' : '';
  return `<span class="a-badge ${cls}">${esc(label(v))}</span>`;
}
function pageControls(prefix, total, offset, count) {
  const page = Math.floor(offset / LIMIT) + 1, pages = Math.max(1, Math.ceil(total / LIMIT));
  $(`#${prefix}-page-info`).textContent = `${total ? offset + 1 : 0}–${offset + count} of ${total}`;
  $(`#${prefix}-prev`).disabled = offset <= 0;
  $(`#${prefix}-next`).disabled = offset + LIMIT >= total;
  return { page, pages };
}
function bindPager(prefix, key, load) {
  $(`#${prefix}-prev`).addEventListener('click', () => { state[key].offset = Math.max(0, state[key].offset - LIMIT); load(); });
  $(`#${prefix}-next`).addEventListener('click', () => { state[key].offset += LIMIT; load(); });
}

/* Dialog helpers */
const dlg = $('#dlg');
function closeDialog() { if (dlg.open) dlg.close(); }
$('#dlg-no').addEventListener('click', closeDialog);
$('#dlg-x').addEventListener('click', closeDialog);
function showDialog(title, content, actionLabel = '', action = null, danger = false) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = content;
  const yes = $('#dlg-yes');
  yes.hidden = !actionLabel; yes.textContent = actionLabel || '';
  yes.classList.toggle('a-btn--danger', danger);
  yes.classList.toggle('a-btn--go', !danger);
  $('#dlg-no').textContent = actionLabel ? 'Cancel' : 'Close';
  yes.onclick = async () => {
    if (!action) return closeDialog();
    yes.disabled = true;
    try { await action(); closeDialog(); }
    catch (e) { fail(e); }
    finally { yes.disabled = false; }
  };
  if (!dlg.open) dlg.showModal();
}
function confirmAction(title, message, labelText, action, danger = false) {
  showDialog(title, `<p>${message}</p>`, labelText, action, danger);
}

/* Overview */
function statCard(title, value, sub = '') {
  return `<article class="a-stat-card"><span>${esc(title)}</span><strong>${Number(value || 0).toLocaleString()}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</article>`;
}
function statGroup(title, cards) {
  return `<section class="a-stat-group"><h2>${esc(title)}</h2><div class="a-stat-grid">${cards.join('')}</div></section>`;
}
function barGroup(title, items, key = 'total') {
  const valid = (items || []).filter(x => Number(x[key]) > 0).slice(0, 8), max = Math.max(1, ...valid.map(x => Number(x[key])));
  return `<section class="a-stat-group"><h2>${esc(title)}</h2><div class="a-chart">${valid.length ? valid.map(x => `<div class="a-chart-row"><span title="${esc(x.name)}">${esc(x.name)}</span><div class="a-track"><i style="width:${Math.max(2, Number(x[key]) / max * 100)}%"></i></div><b>${Number(x[key]).toLocaleString()}</b></div>`).join('') : '<p class="a-muted">No activity to display yet.</p>'}</div></section>`;
}
function statsMarkup(d) {
  const u = d.users || {}, r = d.reports || {}, matches = d.matches || {}, claims = d.claims || {}, recovery = d.recovery || {};
  return `<div class="a-stat-layout">
    ${statGroup('Community', [statCard('Total users', u.total), statCard('Active users', u.active), statCard('Suspended users', u.suspended)])}
    ${statGroup('Lost & found reports', [statCard('Total reports', Number(r.lost || 0) + Number(r.found || 0)), statCard('Lost reports', r.lost), statCard('Found reports', r.found), statCard('New this week', r.new_last_7_days)])}
    ${statGroup('Platform activity', [statCard('Matches', Object.values(matches).reduce((a, b) => a + Number(b || 0), 0)), statCard('Claims', Object.values(claims).reduce((a, b) => a + Number(b || 0), 0)), statCard('Recovery rate', `${recovery.rate || 0}%`, `${recovery.recovered || 0} of ${recovery.lost_total || 0} lost reports`)])}
    <div class="a-stat-bottom">${barGroup('Reports by barangay', d.per_barangay || [])}${statGroup('Claim status', Object.entries(claims).map(([k, v]) => statCard(label(k), v)))}</div>
  </div>`;
}
async function loadStats() {
  const seq = nextSeq('stats'); $('#stats').innerHTML = '<div class="a-loading">Loading dashboard…</div>';
  try { const d = await api(EP.stats); if (seq === state.seq.stats) { $('#stats').innerHTML = statsMarkup(d); error(''); } }
  catch (e) { fail(e); $('#stats').innerHTML = '<p class="a-muted">Statistics could not be loaded.</p>'; }
}
$('#refresh-stats').addEventListener('click', loadStats);

/* Users */
function userRow(u) {
  const id = pick(u, 'id', 'user_id'), name = pick(u, 'name', 'full_name'), suspended = u.status === 'suspended';
  return `<tr><td><div class="a-person"><span class="a-avatar">${esc(initials(name))}</span><span><b>${esc(name || 'Unnamed user')}</b><small>${esc(u.email)}</small></span></div></td>
    <td>${badge(u.role || 'user')}</td><td>${badge(u.status)}</td><td>${date(u.created_at)}</td>
    <td class="r"><button class="a-btn ${suspended ? '' : 'a-btn--danger'}" data-user-action data-id="${esc(id)}" data-name="${esc(name || u.email)}" data-status="${suspended ? 'active' : 'suspended'}">${suspended ? 'Reactivate' : 'Suspend'}</button></td></tr>`;
}
async function loadUsers() {
  const seq = nextSeq('users'); setLoading('#u-rows', 5);
  try {
    const d = await api(EP.users, { query: { q: $('#u-q').value.trim(), status: $('#u-status').value, limit: LIMIT, offset: state.users.offset } });
    if (seq !== state.seq.users) return;
    const items = rowsOf(d); state.users.total = Number(d.total ?? items.length);
    $('#u-rows').innerHTML = items.length ? items.map(userRow).join('') : empty(5, 'No users match these filters.');
    $('#u-total').textContent = `${state.users.total.toLocaleString()} users`;
    pageControls('u', state.users.total, state.users.offset, items.length); error('');
  } catch (e) { fail(e); setLoading('#u-rows', 5, 'Unable to load users.'); }
}
$('#u-rows').addEventListener('click', e => {
  const b = e.target.closest('[data-user-action]'); if (!b) return;
  const to = b.dataset.status, suspend = to === 'suspended';
  confirmAction(suspend ? 'Suspend account?' : 'Reactivate account?', `<b>${esc(b.dataset.name)}</b> will ${suspend ? 'lose access to' : 'regain access to'} their TunTon account.`, suspend ? 'Suspend' : 'Reactivate', async () => {
    await api(EP.userStatus(b.dataset.id), { method: 'PATCH', body: { status: to } });
    state.users.offset = 0; await loadUsers();
  }, suspend);
});
bindPager('u', 'users', loadUsers);

/* Reports */
const reportCache = new Map();
function reportRow(r) {
  const id = pick(r, 'report_id', 'id'), hidden = r.status === 'removed', type = pick(r, 'report_type', 'type'), pet = pick(r, 'pet_name', 'species', 'name') || 'Pet report';
  reportCache.set(String(id), r);
  const flag = r.review_flag ? `<small>${esc(label(String(r.review_flag).replace('report_flagged_', '')))}</small>` : '';
  return `<tr><td><div class="a-report-name"><span class="a-report-icon">${type === 'lost' ? '!' : '✓'}</span><span><b>${esc(pet)}</b><small>${esc(label(type))}${r.barangay ? ` · ${esc(r.barangay)}` : ''}</small></span></div></td>
    <td><b>${esc(r.reporter_name || 'Unknown')}</b><small>${esc(r.reporter_email)}</small></td><td>${badge(hidden ? 'hidden' : r.status)}${flag}</td><td>${date(r.created_at)}</td>
    <td class="r a-actions"><button class="a-btn" data-report-view="${esc(id)}">Review report</button><button class="a-btn" data-report-claims="${esc(id)}">Claims (${Number(r.claims_count || 0)})</button><button class="a-btn ${hidden ? '' : 'a-btn--danger'}" data-report-toggle="${esc(id)}" data-hidden="${hidden}">${hidden ? 'Restore' : 'Hide'}</button></td></tr>`;
}
async function loadReports() {
  const seq = nextSeq('reports'); setLoading('#r-rows', 5);
  try {
    const d = await api(EP.reports, { query: { q: $('#r-q').value.trim(), type: $('#r-type').value, hidden: $('#r-hidden').value, limit: LIMIT, offset: state.reports.offset } });
    if (seq !== state.seq.reports) return;
    const items = rowsOf(d); state.reports.total = Number(d.total ?? items.length);
    $('#r-rows').innerHTML = items.length ? items.map(reportRow).join('') : empty(5, 'No reports match these filters.');
    $('#r-total').textContent = `${state.reports.total.toLocaleString()} reports`;
    pageControls('r', state.reports.total, state.reports.offset, items.length); error('');
  } catch (e) { fail(e); setLoading('#r-rows', 5, 'Unable to load reports.'); }
}
function reportField(labelText, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div><dt>${esc(labelText)}</dt><dd>${esc(value)}</dd></div>`;
}
function safePhotoSrc(photo) {
  const src = typeof photo === 'string' ? photo : pick(photo, 'src', 'url', 'photo_url', 'image_url', 'file_path');
  return /^(https?:|data:image\/(?:jpeg|png|gif|webp);base64,|\/|\.\/)/i.test(String(src)) || (/^[\w./-]+$/.test(String(src)) && !String(src).startsWith('../')) ? String(src) : '';
}
function reportPreviewMarkup(r) {
  const photos = Array.isArray(r.photos) ? r.photos : (r.photos ? [r.photos] : []);
  const images = photos.map((photo, i) => {
    const src = safePhotoSrc(photo);
    return src ? `<img src="${esc(src)}" alt="Report photo ${i + 1}" loading="lazy">` : '';
  }).filter(Boolean);
  const pet = pick(r, 'pet_name', 'name') || 'Pet report';
  const type = label(pick(r, 'report_type', 'type')) || 'Report';
  const location = pick(r, 'pet_location', 'location', 'barangay');
  const species = pick(r, 'species', 'species_name');
  const breed = pick(r, 'breed', 'breed_name');
  const statusFlag = r.review_flag ? label(String(r.review_flag).replace('report_flagged_', '')) : '';
  const animalFields = [
    ['Species', species], ['Breed', breed], ['Color', pick(r, 'color')], ['Size', pick(r, 'size')],
    ['Sex', pick(r, 'sex', 'gender')], ['Age', pick(r, 'age')], ['Markings', pick(r, 'markings')]
  ].map(([k, v]) => reportField(k, v)).join('');
  const locationFields = [
    ['Last seen in', location], ['Last seen on', date(pick(r, 'event_date', 'last_seen_at', 'last_seen_date'))],
    ['Search zone', pick(r, 'search_radius', 'search_zone')], ['Latitude', pick(r, 'lat', 'latitude')], ['Longitude', pick(r, 'lng', 'longitude')]
  ].map(([k, v]) => reportField(k, v)).join('');
  const reporterFields = [
    ['Reported by', pick(r, 'reporter_name', 'owner_name')], ['Posted', datetime(r.created_at)],
    ['Contact', pick(r, 'contact', 'contact_number')], ['Email', pick(r, 'reporter_email')], ['Facebook', pick(r, 'facebook')]
  ].map(([k, v]) => reportField(k, v)).join('');
  return `<div class="a-report-preview">
    <div class="a-report-preview-top"><div><span class="a-badge">${esc(type)}</span>${statusFlag ? ` <span class="a-badge is-bad">Flagged: ${esc(statusFlag)}</span>` : ''}<h3>${esc(pet)}</h3><p>${esc([species, breed, pick(r, 'color')].filter(Boolean).join(' · '))}</p></div><span class="a-badge">${esc(label(r.status))}</span></div>
    <div class="a-report-preview-grid"><div class="a-report-gallery">${images.length ? images.join('') : '<div class="a-photo-empty">No report photos are attached.</div>'}</div>
      <div class="a-report-summary"><section><h4>Reporter</h4><dl class="a-detail-list">${reporterFields || '<div><dt>Details</dt><dd>Not provided</dd></div>'}</dl></section>
      <section><h4>Where it was last seen</h4><dl class="a-detail-list">${locationFields || '<div><dt>Details</dt><dd>Not provided</dd></div>'}</dl></section></div></div>
    <div class="a-report-info-grid"><section><h4>About this pet</h4><dl class="a-detail-list">${animalFields || '<div><dt>Details</dt><dd>Not provided</dd></div>'}</dl></section>
      <section><h4>Description</h4><p class="a-report-description">${esc(pick(r, 'description') || 'No description provided.')}</p></section></div>
    <div class="a-report-review-note"><b>Admin review only</b><span>This is a read-only copy of the user's report. You can flag suspected discrepancies; report details cannot be edited here.</span></div>
    <div class="a-report-flag-actions"><button type="button" class="a-btn a-btn--danger" data-flag-report="${esc(r.report_id || r.id)}" data-flag-type="fraud">Flag as fraud</button><button type="button" class="a-btn a-btn--danger" data-flag-report="${esc(r.report_id || r.id)}" data-flag-type="ai_generated">Flag as AI-generated</button></div>
  </div>`;
}
async function openReport(id) {
  const cached = reportCache.get(String(id));
  showDialog(cached ? 'Report review' : 'Loading report…', cached ? reportPreviewMarkup(cached) : '<p class="a-muted">Loading the user-facing report preview.</p>');
  $('#dlg-yes').hidden = true;
  $('#dlg-no').textContent = 'Close';
  try {
    const d = await api(EP.reportDetail(id));
    const r = d.report || d.item || d;
    $('#dlg-title').textContent = 'Report review';
    $('#dlg-body').innerHTML = reportPreviewMarkup(r);
  } catch (e) {
    if (cached) {
      $('#dlg-title').textContent = 'Report review';
      $('#dlg-body').insertAdjacentHTML('afterbegin', '<p class="a-report-load-note" role="status">Some extended details or photos could not be loaded. Showing the report information available in the reports list.</p>');
    } else {
      fail(e);
      closeDialog();
    }
  }
}
$('#dlg-body').addEventListener('click', e => {
  const button = e.target.closest('[data-flag-report]');
  if (!button) return;
  const { flagReport: id, flagType: type } = button.dataset;
  const humanType = type === 'fraud' ? 'fraud' : 'AI-generated';
  showDialog(`Flag as ${humanType}?`, `<p>Record this as an admin review flag only. The report itself will remain unchanged.</p><label class="a-flag-reason-label" for="flag-reason">Reason for flag</label><textarea id="flag-reason" maxlength="500" rows="4" placeholder="Describe the discrepancy you noticed" required></textarea>`, 'Save flag', async () => {
    const reason = $('#flag-reason').value.trim();
    if (!reason) throw new Error('Please provide a reason for this flag.');
    await api(EP.flagReport(id), { method: 'PATCH', body: { type, reason } });
    closeDialog();
    await loadReports();
  }, true);
});
$('#r-rows').addEventListener('click', async e => {
  const view = e.target.closest('[data-report-view]');
  if (view) { await openReport(view.dataset.reportView); return; }
  const claims = e.target.closest('[data-report-claims]');
  if (claims) {
    try {
      const d = await api(EP.reportClaims(claims.dataset.reportClaims)), items = rowsOf(d);
      showDialog('Claims on this report', items.length ? `<div class="a-claim-list">${items.map(c => `<article><div class="a-claim-head"><b>${esc(c.claimant_name || 'Unknown claimant')}</b>${badge(c.status)}</div><small>${esc(c.claimant_email)} · ${date(c.created_at)}</small><p>${esc(label(c.type))}${c.message ? ` · ${esc(c.message)}` : ''}</p>${c.decision_reason ? `<p>${esc(c.decision_reason)}</p>` : ''}<small>${Number(c.photo_count || 0)} proof photo(s)</small></article>`).join('')}</div>` : '<p class="a-muted">No claims are linked to this report.</p>');
    } catch (err) { fail(err); } return;
  }
  const toggle = e.target.closest('[data-report-toggle]'); if (!toggle) return;
  const hidden = toggle.dataset.hidden === 'true', id = toggle.dataset.reportToggle;
  confirmAction(hidden ? 'Restore report?' : 'Hide report?', hidden ? 'This report will become visible to users again.' : 'This report will be hidden from public lists and the map. It will remain in the database and can be restored.', hidden ? 'Restore' : 'Hide report', async () => {
    if (hidden) await api(EP.restoreReport(id), { method: 'PATCH', body: {} });
    else await api(EP.removeReport(id), { method: 'PATCH', body: { reason: 'Hidden by administrator' } });
    await loadReports();
  }, !hidden);
});
bindPager('r', 'reports', loadReports);

/* Claims */
function claimRow(c) {
  return `<tr><td><div class="a-person"><span class="a-avatar">${esc(initials(c.claimant_name))}</span><span><b>${esc(c.claimant_name || 'Unknown claimant')}</b><small>${esc(c.claimant_email)}</small></span></div></td>
    <td><b>${esc(c.report_pet_name || 'Pet report')}</b><small>${esc(label(c.report_type))} report #${esc(c.report_id)} · Owner: ${esc(c.report_owner_name || 'Unknown')}</small></td>
    <td>${badge(c.type)}<small>${badge(c.status)}</small></td><td>${date(c.created_at)}</td><td class="r"><button class="a-btn" data-claim-view="${esc(c.id)}">View details</button></td></tr>`;
}
const claimCache = new Map();
async function loadClaims() {
  const seq = nextSeq('claims'); setLoading('#c-rows', 5);
  try {
    const d = await api(EP.claims, { query: { q: $('#c-q').value.trim(), status: $('#c-status').value, limit: LIMIT, offset: state.claims.offset } });
    if (seq !== state.seq.claims) return;
    const items = rowsOf(d); state.claims.total = Number(d.total ?? items.length); claimCache.clear(); items.forEach(c => claimCache.set(String(c.id), c));
    $('#c-rows').innerHTML = items.length ? items.map(claimRow).join('') : empty(5, 'No claims match these filters.');
    $('#c-total').textContent = `${state.claims.total.toLocaleString()} claims`;
    pageControls('c', state.claims.total, state.claims.offset, items.length); error('');
  } catch (e) { fail(e); setLoading('#c-rows', 5, 'Unable to load claims. Check that the database migration has been applied.'); }
}
$('#c-rows').addEventListener('click', e => {
  const b = e.target.closest('[data-claim-view]'); if (!b) return;
  const c = claimCache.get(b.dataset.claimView); if (!c) return;
  const fields = [['Claimant', c.claimant_name], ['Email', c.claimant_email], ['Claim type', label(c.type)], ['Claim status', label(c.status)], ['Submitted', datetime(c.created_at)], ['Decision date', datetime(c.decided_at)], ['Decision reason', c.decision_reason], ['Related report', `${c.report_pet_name || 'Pet report'} (#${c.report_id})`], ['Report type', label(c.report_type)], ['Report owner', c.report_owner_name], ['Proof photos', c.photo_count]];
  showDialog('Claim details', `<dl class="a-detail-list">${fields.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`);
});
bindPager('c', 'claims', loadClaims);

/* Activity log */
const LIMIT_LOG = 25;
function logRow(l) {
  const details = typeof l.details === 'object' && l.details ? JSON.stringify(l.details) : String(l.details || '');
  const actor = pick(l, 'user_name', 'user_email') || 'System';
  return `<tr><td>${datetime(l.created_at)}</td><td><b>${esc(actor)}</b><small>${esc(l.user_email)}</small></td><td>${badge(l.action)}</td><td><span class="a-log-target">${esc(l.target_table)} #${esc(l.target_id)}</span>${details ? `<small>${esc(details)}</small>` : ''}</td></tr>`;
}
async function loadLogs(reset = true) {
  if (reset) state.logs.offset = 0;
  const seq = nextSeq('logs'); if (reset) setLoading('#l-rows', 4);
  try {
    const d = await api(EP.logs, { query: { q: $('#l-q').value.trim(), action: $('#l-action').value.trim(), from: $('#l-from').value, to: $('#l-to').value, limit: LIMIT_LOG, offset: state.logs.offset } });
    if (seq !== state.seq.logs) return;
    const items = rowsOf(d); state.logs.total = Number(d.total ?? items.length);
    const html = items.map(logRow).join('');
    $('#l-rows').innerHTML = reset ? (html || empty(4, 'No activity matches these filters.')) : $('#l-rows').innerHTML + html;
    state.logs.offset += items.length;
    $('#l-total').textContent = `${state.logs.total.toLocaleString()} entries`;
    $('#l-page-info').textContent = `Showing ${Math.min(state.logs.offset, state.logs.total)} of ${state.logs.total}`;
    $('#l-more').hidden = state.logs.offset >= state.logs.total || !items.length;
    error('');
  } catch (e) { fail(e); if (reset) setLoading('#l-rows', 4, 'Unable to load activity logs.'); }
}
$('#l-more').addEventListener('click', () => loadLogs(false));


/* Sidebar user card, collapse and My profile */
const profile = (() => {
  const s = session || {}, u = s.user || s.profile || {}, p = s.payload || {};
  return {
    name: pick(u, 'name', 'full_name') || pick(s, 'name', 'full_name') || pick(p, 'name', 'full_name') || '',
    email: pick(u, 'email') || pick(s, 'email') || pick(p, 'email') || '',
    role: pick(u, 'role') || s.role || 'admin',
    status: pick(u, 'status') || pick(s, 'status') || 'active',
    created_at: pick(u, 'created_at') || pick(s, 'created_at') || '',
    exp: p.exp ? p.exp * 1000 : 0
  };
})();
function renderSideUser() {
  const display = profile.name || (profile.email ? profile.email.split('@')[0] : 'Admin');
  $('#side-name').textContent = display;
  $('#side-name').title = display;
  $('#side-avatar').textContent = (display.trim()[0] || 'A').toUpperCase();
}
function renderProfile() {
  const display = profile.name || (profile.email ? profile.email.split('@')[0] : 'Admin');
  const fields = [['Full name', profile.name || display], ['Email', profile.email], ['Role', label(profile.role)], ['Account status', label(profile.status)], ['Member since', profile.created_at ? date(profile.created_at) : ''], ['Session expires', profile.exp ? datetime(profile.exp) : '']];
  $('#profile-card').innerHTML = `<div class="a-profile-top"><span class="a-profile-avatar" aria-hidden="true">${esc((display.trim()[0] || 'A').toUpperCase())}</span><div><h2>${esc(display)}</h2><p>${esc(profile.email || 'No email on file')}</p>${badge(profile.role)}</div></div>
    <dl class="a-detail-list">${fields.filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
async function loadProfile() {
  renderProfile();
  try {
    const d = await api(EP.me), u = d.user || d.profile || d;
    Object.assign(profile, {
      name: pick(u, 'name', 'full_name') || profile.name, email: pick(u, 'email') || profile.email,
      role: pick(u, 'role') || profile.role, status: pick(u, 'status') || profile.status, created_at: pick(u, 'created_at') || profile.created_at
    });
    renderSideUser(); renderProfile();
  } catch { /* keep session details */ }
}
renderSideUser();
const sideCollapse = $('#side-collapse'), COLLAPSE_KEY = 'tunton_admin_side_collapsed';
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
function setCollapsed(on) {
  document.body.classList.toggle('side-collapsed', on);
  sideCollapse.setAttribute('aria-expanded', String(!on));
  sideCollapse.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
}
try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { }
sideCollapse.addEventListener('click', () => {
  if (isMobile()) { $('#admin-sidebar').classList.remove('is-open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); return; }
  const on = !document.body.classList.contains('side-collapsed');
  setCollapsed(on);
  try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch { }
});

/* Navigation, mobile sidebar, and search */
const tabs = { overview: { title: 'Overview', load: loadStats }, users: { title: 'Users', load: loadUsers }, reports: { title: 'Reports', load: loadReports }, claims: { title: 'Claims', load: loadClaims }, logs: { title: 'Activity logs', load: () => loadLogs(true) }, profile: { title: 'My profile', load: loadProfile } };
function route() {
  const key = location.hash.slice(1), tab = tabs[key] ? key : 'overview';
  document.querySelectorAll('.a-content > section').forEach(s => s.hidden = s.id !== `tab-${tab}`);
  document.querySelectorAll('.a-nav a').forEach(a => a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  $('#page-name').textContent = tabs[tab].title;
  error(''); tabs[tab].load();
  $('#admin-sidebar').classList.remove('is-open'); $('#menu-toggle').setAttribute('aria-expanded', 'false');
}
$('#menu-toggle').addEventListener('click', () => {
  const open = $('#admin-sidebar').classList.toggle('is-open');
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
});
[['#u-q', () => { state.users.offset = 0; loadUsers(); }], ['#r-q', () => { state.reports.offset = 0; loadReports(); }], ['#c-q', () => { state.claims.offset = 0; loadClaims(); }], ['#l-q', () => loadLogs(true)], ['#l-action', () => loadLogs(true)]].forEach(([sel, fn]) => $(sel).addEventListener('input', debounce(fn)));
[['#u-status', () => { state.users.offset = 0; loadUsers(); }], ['#r-type', () => { state.reports.offset = 0; loadReports(); }], ['#r-hidden', () => { state.reports.offset = 0; loadReports(); }], ['#c-status', () => { state.claims.offset = 0; loadClaims(); }], ['#l-from', () => loadLogs(true)], ['#l-to', () => loadLogs(true)]].forEach(([sel, fn]) => $(sel).addEventListener('change', fn));
const logoutDialog = $('#logout-dialog');
const cancelLogout = $('#cancel-logout');
$('#logout').addEventListener('click', () => {
  if (logoutDialog?.showModal) {
    logoutDialog.showModal();
    cancelLogout?.focus();
  } else if (window.confirm('Are you sure you want to log out of TunTon?')) {
    logout();
  }
});
cancelLogout?.addEventListener('click', () => logoutDialog?.close());
$('#confirm-logout').addEventListener('click', logout);
logoutDialog?.addEventListener('click', event => {
  if (event.target === logoutDialog) logoutDialog.close();
});
window.addEventListener('hashchange', route);
if (session) route();