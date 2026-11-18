/* =========================================================
   TunTon notifications (bell in the sidebar and the mobile top bar).

   Load this file AFTER common.js on every dashboard page. It needs no backend changes:
   it builds notifications from data the app already loads (reports, finds and claims).

   Three kinds of notification:
     1. response  Someone reported back on YOUR report (a "found it" on your lost report,
                  or a "this is my pet" claim on your found report) and you have not decided yet.
     2. decision  The owner approved or rejected a response that YOU sent.
     3. nearby    Someone else filed a lost or found report within NEARBY_KM of where you are now,
                  in the last NEARBY_DAYS days.

   "Read" state is kept in this browser (localStorage), one list per account.
   For notifications that follow you across devices or arrive when the site is closed,
   see the backend notes in NOTIFICATIONS.md.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Settings you can change ---------- */
  const NEARBY_KM = 3;            /* "near you" radius */
  const NEARBY_DAYS = 3;          /* only reports filed this recently count as new */
  const REFRESH_MS = 2 * 60e3;    /* re-check every 2 minutes while the tab is visible */
  const MAX_SHOWN = 30;

  if (typeof sess === 'undefined' || !sess || typeof loadReports !== 'function') return;

  const STORE = 'tunton_notif:' + myId;
  const loadStore = () => { const s = read(STORE, {}); return { read: s.read || {}, muted: !!s.muted }; };
  let store = loadStore();
  const saveStore = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* storage full */ } };

  let items = [];     /* newest first: { key, kind, title, text, reportId, at } */
  let open = false;

  /* The stylesheet is loaded by this script so the pages need only one new line. */
  const here = document.currentScript && document.currentScript.src;
  if (here && !document.querySelector('link[data-notif-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = here.replace(/js\/notifications\.js.*$/, 'css/notifications.css');
    link.dataset.notifCss = '';
    document.head.appendChild(link);
  }
  /* Web Push (works when the site is closed). Lives in js/push.js at the site root. */
  if (here && !window.TuntonPush && !document.querySelector('script[data-push-js]')) {
    const sc = document.createElement('script');
    sc.src = here.replace(/pages\/user\/dashboard\/js\/notifications\.js.*$/, 'js/push.js');
    sc.dataset.pushJs = '';
    sc.onload = () => { refreshPush(); offerPush(); };
    document.head.appendChild(sc);
  }

  /* ---------- Build the list ---------- */
  const petLabel = r => midEllipsis(r.name || speciesOf(r) || 'pet', 20, 6) + (r.brgy ? ' in ' + r.brgy : '');

  async function build() {
    const reports = _reportCache;
    const out = [];

    for (const r of reports) {
      if (r.status === 'reunited') continue;

      if (r.owner === myId) {
        /* 1. someone reported back on my report */
        const list = r.kind === 'lost' ? findsOf(r) : claimsOf(r);
        for (const c of list) {
          if (c.by === myId || c.status !== 'pending') continue;
          out.push({
            key: 'response:' + c.id,
            kind: 'response',
            title: r.kind === 'lost' ? 'Someone may have found your pet' : 'Someone says this is their pet',
            text: midEllipsis(c.founderName || 'A user', 20, 6) + ' responded to your ' + r.kind + ' report for ' + petLabel(r) + '.',
            reportId: r.id,
            at: c.at || r.created
          });
        }
      } else {
        /* 2. my response was decided */
        const mine = (r.kind === 'lost' ? findsOf(r) : claimsOf(r)).filter(c => c.by === myId);
        for (const c of mine) {
          if (c.status !== 'confirmed' && c.status !== 'rejected') continue;
          const ok = c.status === 'confirmed';
          out.push({
            key: 'decision:' + c.id + ':' + c.status,
            kind: 'decision',
            title: ok ? 'Your response was approved' : 'Your response was marked not a match',
            text: (ok ? 'The owner approved your response for ' : 'The owner did not match your response for ') + petLabel(r) + '.' +
              (!ok && c.decisionReason ? ' Reason: ' + c.decisionReason : ''),
            reportId: r.id,
            at: c.at || r.created
          });
        }
      }
    }

    /* 3. new reports near me (only if location is available) */
    const me = await whereAmI().catch(() => null);
    if (me) {
      const since = Date.now() - NEARBY_DAYS * 864e5;
      for (const r of reports) {
        if (r.owner === myId || r.status === 'reunited') continue;
        if (!r.created || r.created < since || !isFinite(r.lat) || !isFinite(r.lng)) continue;
        const d = km(me, [r.lat, r.lng]);
        if (d > NEARBY_KM) continue;
        out.push({
          key: 'nearby:' + r.id,
          kind: 'nearby',
          title: r.kind === 'lost' ? 'Lost pet reported near you' : 'Found pet reported near you',
          text: (r.kind === 'lost' ? 'A lost ' : 'A found ') + (speciesOf(r) || 'pet').toLowerCase() + ' was reported ' + distText(d) + ' away' + (r.brgy ? ' in ' + r.brgy : '') + '.',
          reportId: r.id,
          at: r.created
        });
      }
    }

    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    items = out.slice(0, MAX_SHOWN);

    /* forget read marks for things that no longer exist, so the store stays small */
    const live = new Set(out.map(n => n.key));
    let pruned = false;
    for (const k of Object.keys(store.read)) if (!live.has(k)) { delete store.read[k]; pruned = true; }
    if (pruned) saveStore();
  }

  const unread = () => store.muted ? 0 : items.filter(n => !store.read[n.key]).length;

  /* ---------- UI ---------- */
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const ICONS = {
    response: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    decision: '<path d="M20 6 9 17l-5-5"/>',
    nearby: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'
  };

  let panel, buttons = [];

  /* ---------- Push row (inside the panel) ---------- */
  let pushState = 'unsupported', pushBusy = false, pushError = '';
  async function refreshPush() {
    pushState = window.TuntonPush ? await window.TuntonPush.status() : 'unsupported';
    if (open) renderPanel();
  }

  /* Asks for notification permission by itself after login.
     1. Waits for the location popup to finish, so two browser popups never stack.
     2. Calls the browser's real permission popup directly (Chrome and Edge allow this without a click).
     3. If the browser did not show it (Firefox, Safari and quiet-mode Chrome need a click), shows a small
        "Turn on alerts" card whose button makes the click.
     It tries once per 7 days per account, so a person who ignores it is not nagged on every page. */
  async function offerPush() {
    try {
      const P = window.TuntonPush;
      if (!P || !P.supported || (await P.status()) !== 'off') return;   /* already on, blocked, or unsupported */

      /* Allowed earlier but this browser is not subscribed yet: no popup needed, just subscribe. */
      if (Notification.permission === 'granted') { await P.enable().catch(() => {}); refreshPush(); return; }

      const KEY = 'tunton_push_asked:' + myId;
      if (Date.now() - Number(localStorage.getItem(KEY) || 0) < 7 * 864e5) return;
      try { localStorage.setItem(KEY, Date.now()); } catch (e) { /* ignore */ }

      await whereAmI().catch(() => null);
      if (document.querySelector('.notif-ask')) return;

      /* Step 2: ask the browser directly. Resolves once the person answers (or throws if it cannot ask without a click). */
      try { await P.enable(); refreshPush(); return; } catch (e) { /* fall through */ }
      refreshPush();
      if (Notification.permission !== 'default') return;   /* blocked: the bell panel explains how to unblock */

      /* Step 3: the browser did not ask, so offer a button. */
      const box = document.createElement('div');
      box.className = 'notif-ask';
      box.setAttribute('role', 'dialog');
      box.innerHTML = `
        <strong>Get alerts when a pet is found</strong>
        <p>Turn on notifications so TunTon can tell you right away, even when the site is closed.</p>
        <div><button type="button" class="notif-ask-yes">Turn on alerts</button>
        <button type="button" class="notif-ask-no">Not now</button></div>`;
      document.body.appendChild(box);
      box.querySelector('.notif-ask-no').onclick = () => box.remove();
      box.querySelector('.notif-ask-yes').onclick = async () => {
        try { await P.enable(); } catch (e) { /* denied or failed: the bell panel shows the state */ }
        box.remove();
        refreshPush();
      };
    } catch (e) { /* never break the page */ }
  }
  function pushRow() {
    if (pushError) return `<p class="notif-push notif-push--warn" role="alert">${esc(pushError)}</p>`;
    switch (pushState) {
      case 'off':
        return `<div class="notif-push"><span>Get alerts even when TunTon is closed.</span>
          <button type="button" class="notif-push-btn" data-act="push-on" ${pushBusy ? 'disabled' : ''}>${pushBusy ? 'Turning on...' : 'Turn on'}</button></div>`;
      case 'on':
        return `<div class="notif-push notif-push--on"><span>Push alerts are on for this device.</span>
          <button type="button" class="notif-link" data-act="push-off">Turn off</button></div>`;
      case 'denied':
        return `<p class="notif-push notif-push--warn">Notifications are blocked for this site. Allow them in your browser's site settings to turn on push alerts.</p>`;
      case 'needs-install':
        return `<p class="notif-push">On iPhone/iPad: tap Share, then "Add to Home Screen", open TunTon from there, and turn on push alerts.</p>`;
      default:
        return '';
    }
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('section');
    panel.className = 'notif-panel';
    panel.id = 'notif-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Notifications');
    panel.addEventListener('click', onPanelClick);
    document.body.appendChild(panel);
    return panel;
  }

  function ago2(ts) {
    if (!ts) return '';
    const m = Math.round((Date.now() - ts) / 6e4);
    if (m < 1) return 'Just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24);
    return d === 1 ? 'Yesterday' : d + ' days ago';
  }

  function renderPanel() {
    ensurePanel();
    const n = unread();
    const rows = items.map(it => `
      <li>
        <a class="notif-item notif-${it.kind}${store.read[it.key] ? '' : ' is-new'}" href="report.html?id=${encodeURIComponent(it.reportId)}" title="${esc(it.title + ': ' + it.text)}" data-key="${esc(it.key)}">
          <span class="notif-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[it.kind]}</svg></span>
          <span class="notif-body"><b>${esc(it.title)}</b><span>${esc(it.text)}</span><small>${esc(ago2(it.at))}</small></span>
        </a>
      </li>`).join('');
    panel.innerHTML = `
      <header class="notif-head">
        <h2>Notifications</h2>
        <div class="notif-tools">
          <button type="button" class="notif-link" data-act="readall" ${n ? '' : 'disabled'}>Mark all as read</button>
          <button type="button" class="notif-link" data-act="mute" aria-pressed="${store.muted}">${store.muted ? 'Turn on' : 'Mute'}</button>
        </div>
      </header>
      ${pushRow()}
      ${store.muted ? '<p class="notif-empty">Notifications are muted. Turn them on to see the badge again.</p>'
        : items.length ? `<ul class="notif-list">${rows}</ul>`
        : `<p class="notif-empty">You are all caught up.<br><small>We will tell you when someone responds to your report or a pet is reported within ${NEARBY_KM} km of you.</small></p>`}`;
  }

  function renderButtons() {
    const n = unread();
    buttons.forEach(b => {
      const badge = b.querySelector('.notif-badge');
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.hidden = !n;
      b.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
    });
    if (open) renderPanel();
  }

  function makeButton(extraClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'notif-btn ' + extraClass;
    b.setAttribute('aria-haspopup', 'true');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'notif-panel');
    b.setAttribute('aria-label', 'Notifications');
    b.title = 'Notifications';
    b.innerHTML = BELL + '<span class="notif-badge" hidden></span>';
    b.addEventListener('click', e => { e.stopPropagation(); setOpen(!open, b); });
    buttons.push(b);
    return b;
  }

  function setOpen(v, anchor) {
    open = v;
    ensurePanel();
    if (v) {
      renderPanel();
      refreshPush();
      /* on a phone the panel hangs from the top bar, on desktop from the sidebar */
      panel.classList.toggle('from-top', !!anchor && !!anchor.closest('.dash-top, .dash-bar'));
    }
    panel.hidden = !v;
    buttons.forEach(b => b.setAttribute('aria-expanded', String(v)));
    if (!v && anchor) anchor.focus();
  }

  function onPanelClick(e) {
    const act = e.target.closest('[data-act]');
    if (act && (act.dataset.act === 'push-on' || act.dataset.act === 'push-off')) {
      togglePush(act.dataset.act === 'push-on');
      return;
    }
    if (act) {
      if (act.dataset.act === 'readall') { items.forEach(n => { store.read[n.key] = 1; }); }
      if (act.dataset.act === 'mute') store.muted = !store.muted;
      saveStore(); renderButtons(); renderPanel();
      return;
    }
    const link = e.target.closest('.notif-item');
    if (link) { store.read[link.dataset.key] = 1; saveStore(); }   /* then the link opens the report */
  }

  async function togglePush(on) {
    if (!window.TuntonPush || pushBusy) return;
    pushBusy = true; pushError = ''; renderPanel();
    try { await (on ? window.TuntonPush.enable() : window.TuntonPush.disable()); }
    catch (err) { pushError = err.message || 'Could not change push alerts'; setTimeout(() => { pushError = ''; if (open) renderPanel(); }, 5000); }
    pushBusy = false;
    await refreshPush();
  }

  document.addEventListener('click', e => { if (open && !e.target.closest('.notif-panel')) setOpen(false); });
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape') setOpen(false, buttons[0]); });

  /* ---------- Mount (waits for the sidebar that sidebar.js loads) ---------- */
  async function refresh() {
    try { await build(); } catch (err) { console.error('notifications:', err); }
    renderButtons();
  }

  (window.sidebarReady || Promise.resolve(false)).then(ok => {
    if (!ok) return;

    /* Each bell takes the place of a same-size placeholder from sidebar.html, so nothing shifts or flashes */
    const profile = document.querySelector('.side-profile');
    if (profile) {
      const slot = profile.querySelector('.notif-slot');
      const b = makeButton('notif-btn--side');
      if (slot) slot.replaceWith(b); else profile.insertBefore(b, profile.querySelector('.theme-toggle'));
    }
    const topActions = document.querySelector('.dash-top-actions');
    if (topActions) {
      const slot = topActions.querySelector('.notif-slot');
      const b = makeButton('notif-btn--top');
      if (slot) slot.replaceWith(b); else topActions.insertBefore(b, topActions.firstChild);
    }
    if (!buttons.length) return;

    /* first paint from the reports the page already loaded, then keep them fresh */
    reportsReady.then(refresh).catch(() => {});

    const poll = async () => {
      if (document.hidden) return;
      try { await loadReports(); } catch (e) { return; }   /* offline: keep what we have */
      refresh();
    };
    setInterval(poll, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    /* sw.js tells open pages when a push arrives, so the bell updates at once instead of at the next 2-minute check */
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'push-received') poll(); });
  });

  if (window.TuntonPush) offerPush();
})();