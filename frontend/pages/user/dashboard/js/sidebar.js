/* =========================================================
   Loads sidebar.html into every dashboard page.

   Each page only has <div id="app-nav"></div> and loads this file
   before common.js. The markup itself lives in sidebar.html.

   window.sidebarReady resolves (true/false) once the sidebar is on
   the page. common.js waits for it before wiring the buttons.
   ========================================================= */

window.sidebarReady = (async function () {
  const mount = document.getElementById('app-nav'), main = document.querySelector('.dash-main');
  if (!mount || !main) { console.error('sidebar.js: add <div id="app-nav"></div> inside .dash'); return false; }

  try {
    /* The menu markup is cached for the browser tab. Every tab click is a full page load, and waiting
       for fetch() each time is what made the sidebar vanish for a moment. With a cached copy this
       function reaches the mount below WITHOUT awaiting anything, so the sidebar is on the page
       before the first paint. The copy is refreshed in the background (edits to sidebar.html show
       up from the next page on). */
    const CACHE = 'tunton_sidebar_html';
    const fetchMenu = async () => {
      const res = await fetch('sidebar.html');
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      /* drop any <script> a dev server (e.g. Live Server) injected into the file */
      const txt = (await res.text()).replace(/<script[\s\S]*?(<\/script>|$)/gi, '');
      try { sessionStorage.setItem(CACHE, txt); } catch (e) { /* storage unavailable */ }
      return txt;
    };
    let html = null;
    try { html = sessionStorage.getItem(CACHE); } catch (e) { /* storage unavailable */ }
    if (html == null) html = await fetchMenu();   /* first page of the visit only */
    else fetchMenu().catch(() => {});             /* refresh for the next page */
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const sb = doc.querySelector('#sidebar'), scrim = doc.querySelector('#scrim'), top = doc.querySelector('.dash-top');
    if (!sb || !scrim || !top) throw new Error('sidebar.html must contain #sidebar, #scrim and .dash-top. Is the file complete?');

    mount.replaceWith(sb, scrim);
    main.prepend(top);
    const logoutDlg = doc.querySelector('#logout-dialog');   /* the logout confirmation lives in sidebar.html too */
    if (logoutDlg) document.body.append(logoutDlg);
    window.TunTonTheme?.sync();   /* label/aria of the theme button that just arrived */

    /* highlight the link for the current page */
    /* Compare pages by name WITHOUT ".html", so clean URLs (/dashboard), trailing slashes and
       servers that redirect dashboard.html -> /dashboard still find the right tab. */
    const pageName = p => (String(p).split('/').pop() || 'dashboard').replace(/\.html?$/i, '').toLowerCase();
    let here = pageName(location.pathname);
    if (here === 'report') here = /[?&]match=/.test(location.search) ? 'matching' : 'reports';   /* details page belongs under All reports */
    document.querySelectorAll('.side-nav a').forEach(a => {
      if (pageName(new URL(a.getAttribute('href'), location.href).pathname) === here) a.setAttribute('aria-current', 'page');
    });

    /* ---------- Tab switching animation ----------
       Every tab is its own page, so the sliding highlight is carried across the page load:
       a click saves where the highlight was, and the next page starts it there and slides it
       to the new tab. The page content fades out on click and fades in on arrival (layout.css). */
    const nav = document.querySelector('.side-nav'), root = document.documentElement;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const current = () => nav.querySelector('a[aria-current="page"]');
    const NAV_KEY = 'tunton_nav';
    const ind = document.createElement('span');
    ind.className = 'side-indicator';
    ind.setAttribute('aria-hidden', 'true');
    nav.prepend(ind);
    nav.classList.add('has-indicator');

    /* Once the highlight has arrived, the active link paints its own fill (CSS .is-settled) and the
       sliding element is hidden. The effect then no longer depends on a pixel measurement. */
    let settleTimer = 0;
    const unsettle = () => { clearTimeout(settleTimer); nav.classList.remove('is-settled'); };
    const settle = delay => { clearTimeout(settleTimer); settleTimer = setTimeout(() => nav.classList.add('is-settled'), delay); };

    const place = (a, animate) => {
      const y = a.offsetTop, h = a.offsetHeight;
      if (ind.dataset.y === String(y) && ind.dataset.h === String(h)) return;   /* already there */
      ind.dataset.y = y; ind.dataset.h = h;
      ind.style.transition = animate ? '' : 'none';
      ind.style.height = h + 'px';
      ind.style.transform = 'translateY(' + y + 'px)';
      if (!animate) void ind.offsetHeight;   /* apply now, so the next change can animate */
    };

    const active = current();
    if (active) {
      let from = null;
      try { from = JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null'); sessionStorage.removeItem(NAV_KEY); } catch (e) { /* storage unavailable */ }
      if (from && !reduce && Date.now() - from.t < 4000) {
        place(active, false);   /* measure once so the start is a real position */
        delete ind.dataset.y;
        ind.style.transition = 'none';
        ind.style.height = from.h + 'px';
        ind.style.transform = 'translateY(' + from.y + 'px)';
        void ind.offsetHeight;
        requestAnimationFrame(() => place(active, true));
        settle(500);   /* slide is .4s */
      } else {
        place(active, false);
        settle(0);
      }
      /* The highlight is drawn by the .side-indicator (the active link itself is transparent), and it is
         positioned from a one-time measurement. Anything that later moves the links WITHOUT resizing
         the nav (web fonts / logo images finishing, minimize toggling the header layout, the scrollbar
         appearing once the reports load) left it stranded, so the tab looked unselected.
         Re-measure (no animation) on every such event. */
      const resync = () => { const c = current(); if (c) place(c, false); };
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(resync);
        ro.observe(nav);
        ro.observe(document.getElementById('sidebar'));
        nav.querySelectorAll('a').forEach(a => ro.observe(a));
        const head = document.querySelector('.side-head');
        if (head) ro.observe(head);
      }
      window.addEventListener('load', resync);
      window.addEventListener('resize', resync);
      document.getElementById('sidebar').addEventListener('transitionend', resync);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(resync);
      document.documentElement.addEventListener('transitionend', e => { if (e.target.classList && e.target.classList.contains('dash')) resync(); });
    }

    /* Clicking a sidebar link: slide the highlight, fade the page out, then go. */
    document.getElementById('sidebar').addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
      const href = a.getAttribute('href');
      if (pageName(new URL(a.href).pathname) === pageName(location.pathname)) {
        e.preventDefault();
        if (href === 'add-report.html' && document.querySelector('.done:not([hidden])')) location.href = href;   /* after filing: open a fresh form */
        return;
      }   /* already on this page */
      try { if (ind.dataset.h) sessionStorage.setItem(NAV_KEY, JSON.stringify({ y: +ind.dataset.y, h: +ind.dataset.h, t: Date.now() })); } catch (err) { /* ignore */ }
      if (reduce) return;
      e.preventDefault();
      /* The highlight stays on the current tab while the page fades out. Its position was saved above, and the
         NEXT page starts the highlight there and slides it to the new tab. Sliding here as well would be cut
         off by the navigation and then played again, which looked like two animations. */
      root.classList.add('is-leaving');
      setTimeout(() => { location.href = a.href; }, 220);
    });
    window.addEventListener('pageshow', e => { if (e.persisted) root.classList.remove('is-leaving'); });
    return true;
  } catch (err) {
    console.error('Could not load sidebar.html. Open the site through a local server (Live Server), not file://.', err);
    return false;
  }
})();