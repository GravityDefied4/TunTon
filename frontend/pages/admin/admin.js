/* =========================================================
   TunTon admin dashboard.
   Every backend route is listed in EP below. If your routes differ, change them here only.
   All responses are read as { success, message, data } (the same envelope the auth routes use).
   ========================================================= */
const API = window.TUNTON?.API_BASE ?? '/api', HOME = '../../index.html', SESSION_KEY = 'tunton_session';
const EP = {
  stats: '/admin/stats',                                // GET
  users: '/admin/users',                                // GET ?q=&status=active|suspended
  userStatus: id => `/admin/users/${id}/status`,        // PATCH { status: 'active' | 'suspended' }
  reports: '/admin/reports',                            // GET ?q=&type=lost|found&hidden=true|false  (q matches pet, reporter name and email)
  claims: id => `/admin/reports/${id}/claims`,          // GET
  visibility: id => `/admin/reports/${id}/visibility`,  // PATCH { hidden: true | false }  (hide = soft remove, so it can be restored)
  logs: '/admin/logs'                                   // GET ?q=&action=&from=&to=&page=&limit=
};

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return ''; };   // first field the API filled in
const day = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const when = d => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const label = k => String(k).replace(/[_.]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const list = d => Array.isArray(d) ? d : (d?.items || d?.rows || d?.users || d?.reports || d?.logs || d?.claims || []);
const empty = (cols, text) => `<tr><td class="a-empty" colspan="${cols}">${text}</td></tr>`;
const debounce = (fn, ms = 300) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
const seq = {};                                          // ignores slow answers that arrive after a newer search
const next = k => (seq[k] = (seq[k] || 0) + 1);

/* ---------- Session: only a logged-in admin may stay ---------- */
const sess = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY)), p = JSON.parse(atob(s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.exp * 1000 > Date.now() ? { ...s, role: s.role || p.role } : null;
  } catch { return null; }
})();
const logout = () => { localStorage.removeItem(SESSION_KEY); location.replace(HOME); };
if (!sess) logout();
else if (sess.role && sess.role !== 'admin') location.replace(HOME);   // a normal user; the server enforces this too

async function api(path, { method = 'GET', query, body } = {}) {
  const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== '' && v != null));
  const res = await fetch(API + path + (qs.size ? '?' + qs : ''), {
    method, headers: { Authorization: 'Bearer ' + sess.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body)
  });
  if (res.status === 401) return logout();
  let json = {};
  try { json = await res.json(); } catch { /* no body */ }
  if (res.status === 403) throw new Error('This account is not allowed to use the admin tools.');
  if (!res.ok || json.success === false) throw new Error(json.message || 'Something went wrong. Please try again.');
  return json.data ?? json;
}
const showError = msg => { const el = $('#error'); el.hidden = !msg; el.textContent = msg || ''; };
const fail = e => showError(e?.message || 'Could not reach the TunTon server.');

/* ---------- Dialog: confirm an action, or just show information ---------- */
const dlg = $('#dlg');
function ask({ title, body, yes, danger }) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = body;
  const y = $('#dlg-yes');
  y.hidden = !yes; y.textContent = yes || ''; y.classList.toggle('a-btn--warn', !!danger); y.classList.toggle('a-btn--go', !danger);
  $('#dlg-no').textContent = yes ? 'Cancel' : 'Close';
  return new Promise(done => {
    y.onclick = () => { dlg.close(); done(true); };
    $('#dlg-no').onclick = () => dlg.close();
    dlg.addEventListener('close', () => done(false), { once: true });
    dlg.showModal();
  });
}

/* ---------- Overview: statistics ---------- */
/* Shows whatever the stats route returns: plain numbers become cards, an object becomes a titled group of cards,
   and a list of { label, count } becomes bars. */
const group = (title, o) => `<section class="a-group"><h2>${esc(label(title))}</h2><div class="a-cards">${Object.entries(o)
  .filter(([, v]) => v !== null && v !== '' && !isNaN(v)).map(([k, v]) => `<div class="a-card"><b>${Number(v).toLocaleString()}</b><span>${esc(label(k))}</span></div>`).join('')}</div></section>`;
function statsHTML(d) {
  const top = {}, rest = [];
  for (const [k, v] of Object.entries(d.stats && typeof d.stats === 'object' ? d.stats : d)) {
    if (Array.isArray(v)) {
      const rows = v.map(x => [pick(x, 'label', 'name', 'barangay', 'species', 'date', 'key'), Number(pick(x, 'count', 'total', 'value')) || 0]), max = Math.max(1, ...rows.map(r => r[1]));
      rest.push(`<section class="a-group"><h2>${esc(label(k))}</h2><div class="a-bars">${rows.map(([n, c]) => `<div class="a-bar-row"><span>${esc(n)}</span><i style="width:${c / max * 100}%"></i><b>${c}</b></div>`).join('') || 'No data yet.'}</div></section>`);
    } else if (v && typeof v === 'object') rest.push(group(k, v));
    else top[k] = v;
  }
  return (Object.keys(top).length ? group('Totals', top) : '') + rest.join('');
}
async function loadStats() {
  const i = next('s'), box = $('#stats');
  try { const d = await api(EP.stats); if (i === seq.s) box.innerHTML = statsHTML(d) || '<p>No statistics yet.</p>'; } catch (e) { fail(e); }
}

/* ---------- Users: search by name, email or status; suspend / reactivate ---------- */
const userRow = u => {
  const id = pick(u, 'id', '_id'), name = pick(u, 'name', 'full_name'), status = String(u.status || 'active').toLowerCase(), sus = status === 'suspended';
  return `<tr><td><div class="a-who"><span class="a-av">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc((name || '?')[0].toUpperCase())}</span><div>${esc(name)}<small>${esc(u.email)}</small></div></div></td>
    <td><span class="a-badge ${sus ? 'a-badge--warn' : ''}">${sus ? 'Suspended' : 'Active'}</span></td><td>${day(pick(u, 'created_at', 'createdAt'))}</td>
    <td class="r"><button type="button" class="a-btn ${sus ? '' : 'a-btn--warn'}" data-act="status" data-id="${esc(id)}" data-name="${esc(name || u.email)}" data-to="${sus ? 'active' : 'suspended'}">${sus ? 'Reactivate' : 'Suspend'}</button></td></tr>`;
};
async function loadUsers() {
  const i = next('u'), rows = $('#u-rows');
  try {
    const d = list(await api(EP.users, { query: { q: $('#u-q').value.trim(), status: $('#u-status').value } }));
    if (i === seq.u) { showError(''); rows.innerHTML = d.length ? d.map(userRow).join('') : empty(4, 'No users match your search.'); }
  } catch (e) { fail(e); }
}
$('#u-rows').addEventListener('click', async e => {
  const b = e.target.closest('[data-act="status"]');
  if (!b) return;
  const sus = b.dataset.to === 'suspended';
  const ok = await ask({
    title: sus ? 'Suspend this account?' : 'Reactivate this account?', danger: sus, yes: sus ? 'Suspend' : 'Reactivate',
    body: `<p><b>${esc(b.dataset.name)}</b> ${sus ? 'will be signed out and will not be able to log in until you reactivate the account.' : 'will be able to log in again.'}</p>`
  });
  if (!ok) return;
  try { await api(EP.userStatus(b.dataset.id), { method: 'PATCH', body: { status: b.dataset.to } }); loadUsers(); } catch (err) { fail(err); }
});

/* ---------- Reports: search with the reporter's name and email; claims; hide / restore ---------- */
const isHidden = r => !!(r.hidden || r.is_hidden || r.hidden_at || r.status === 'hidden');
const reportRow = r => {
  const id = pick(r, 'id', '_id'), hid = isHidden(r), photo = pick(r, 'photo_url', 'photo'), type = pick(r, 'type', 'kind');
  const who = pick(r, 'reporter_name', 'owner_name', 'user_name'), mail = pick(r, 'reporter_email', 'owner_email', 'user_email'), n = Number(pick(r, 'claims_count', 'claimsCount')) || 0;
  return `<tr class="${hid ? 'is-hidden' : ''}"><td><div class="a-who"><span class="a-av a-av--sq">${photo ? `<img src="${esc(photo)}" alt="">` : '🐾'}</span>
    <div>${esc(pick(r, 'pet_name', 'name') || pick(r, 'species') || 'Pet')}<small>${esc(label(type))}${pick(r, 'barangay', 'brgy') ? ' · ' + esc(pick(r, 'barangay', 'brgy')) : ''} ${hid ? '<span class="a-badge a-badge--warn">Hidden</span>' : ''}</small></div></div></td>
    <td>${esc(who)}<small>${esc(mail)}</small></td><td>${day(pick(r, 'date_reported', 'created_at'))}</td>
    <td class="r"><button type="button" class="a-btn" data-act="claims" data-id="${esc(id)}">Claims (${n})</button><button type="button" class="a-btn ${hid ? '' : 'a-btn--warn'}" data-act="vis" data-id="${esc(id)}" data-hide="${!hid}">${hid ? 'Restore' : 'Hide'}</button></td></tr>`;
};
async function loadReports() {
  const i = next('r'), rows = $('#r-rows');
  try {
    const d = list(await api(EP.reports, { query: { q: $('#r-q').value.trim(), type: $('#r-type').value, hidden: $('#r-hidden').value } }));
    if (i === seq.r) { showError(''); rows.innerHTML = d.length ? d.map(reportRow).join('') : empty(4, 'No reports match your search.'); }
  } catch (e) { fail(e); }
}
const claimItem = c => {
  const st = String(c.status || 'pending').toLowerCase(), who = pick(c, 'claimant_name', 'user_name', 'name'), mail = pick(c, 'claimant_email', 'user_email', 'email'), note = pick(c, 'message', 'description', 'details');
  return `<li><b>${esc(who || 'Unknown')}</b> <span class="a-badge ${st === 'rejected' ? 'a-badge--warn' : ''}">${esc(label(st))}</span><small>${esc(mail)}${pick(c, 'created_at') ? ' · ' + esc(day(c.created_at)) : ''}${pick(c, 'contact') ? ' · ' + esc(c.contact) : ''}</small>${note ? `<p>${esc(note)}</p>` : ''}</li>`;
};
$('#r-rows').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'claims') {
    try { const d = list(await api(EP.claims(b.dataset.id))); ask({ title: 'Claims on this report', body: d.length ? `<ul>${d.map(claimItem).join('')}</ul>` : '<p>Nobody has claimed this report yet.</p>' }); } catch (err) { fail(err); }
    return;
  }
  const hide = b.dataset.hide === 'true';
  const ok = await ask({
    title: hide ? 'Hide this report?' : 'Restore this report?', danger: hide, yes: hide ? 'Hide report' : 'Restore',
    body: `<p>${hide ? 'It will disappear for everyone. Nothing is deleted, so you can restore it from the Hidden filter at any time.' : 'It will show again on the map and in the lists.'}</p>`
  });
  if (!ok) return;
  try { await api(EP.visibility(b.dataset.id), { method: 'PATCH', body: { hidden: hide } }); loadReports(); } catch (err) { fail(err); }
});

/* ---------- Activity logs: filter, then load more ---------- */
const LIMIT = 25;
let logPage = 1;
const logRow = l => {
  const a = String(pick(l, 'action', 'type')), d = pick(l, 'details', 'description', 'message'), target = pick(l, 'target_type') ? `${label(l.target_type)} ${pick(l, 'target_id')}` : '';
  const bad = /suspend|hide|delete|remove|reject/i.test(a);
  return `<tr><td>${esc(when(pick(l, 'created_at', 'timestamp')))}</td><td>${esc(pick(l, 'admin_name', 'actor_name', 'admin_email', 'actor', 'admin'))}</td>
    <td><span class="a-badge ${bad ? 'a-badge--warn' : ''}">${esc(label(a))}</span></td><td>${esc(typeof d === 'object' ? JSON.stringify(d) : d || target)}</td></tr>`;
};
async function loadLogs(reset) {
  const i = next('l'), rows = $('#l-rows'), more = $('#l-more');
  if (reset) logPage = 1;
  try {
    const d = list(await api(EP.logs, { query: { q: $('#l-q').value.trim(), action: $('#l-action').value.trim(), from: $('#l-from').value, to: $('#l-to').value, page: logPage, limit: LIMIT } }));
    if (i !== seq.l) return;
    showError('');
    const html = d.map(logRow).join('');
    rows.innerHTML = reset ? (html || empty(4, 'No log entries match your filters.')) : rows.innerHTML + html;
    more.hidden = d.length < LIMIT;
  } catch (e) { fail(e); }
}
$('#l-more').addEventListener('click', () => { logPage++; loadLogs(false); });

/* ---------- Tabs and wiring ---------- */
const TABS = { overview: loadStats, users: loadUsers, reports: loadReports, logs: () => loadLogs(true) };
function route() {
  const t = TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('.a-main > section').forEach(s => { s.hidden = s.id !== 'tab-' + t; });
  document.querySelectorAll('.a-nav a').forEach(a => a.dataset.tab === t ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  showError('');
  TABS[t]();
}
[['#u-q', loadUsers], ['#r-q', loadReports], ['#l-q', () => loadLogs(true)], ['#l-action', () => loadLogs(true)]].forEach(([s, fn]) => $(s).addEventListener('input', debounce(fn)));
[['#u-status', loadUsers], ['#r-type', loadReports], ['#r-hidden', loadReports], ['#l-from', () => loadLogs(true)], ['#l-to', () => loadLogs(true)]].forEach(([s, fn]) => $(s).addEventListener('change', fn));
$('#logout').addEventListener('click', logout);
window.addEventListener('hashchange', route);
if (sess) route();
