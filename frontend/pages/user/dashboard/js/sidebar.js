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
    const res = await fetch('sidebar.html');
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    /* drop any <script> a dev server (e.g. Live Server) injected into the file */
    const html = (await res.text()).replace(/<script[\s\S]*?(<\/script>|$)/gi, '');
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const sb = doc.querySelector('#sidebar'), scrim = doc.querySelector('#scrim'), top = doc.querySelector('.dash-top');
    if (!sb || !scrim || !top) throw new Error('sidebar.html must contain #sidebar, #scrim and .dash-top. Is the file complete?');

    mount.replaceWith(sb, scrim);
    main.prepend(top);
    window.TunTonTheme?.sync();   /* label/aria of the theme button that just arrived */

    /* highlight the link for the current page */
    let here = location.pathname.split('/').pop() || 'dashboard.html';
    if (here === 'report.html') here = /[?&]match=/.test(location.search) ? 'matching.html' : 'reports.html';   /* details page belongs under All reports */
    document.querySelectorAll('.side-nav a').forEach(a => {
      if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
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
      } else {
        place(active, false);
      }
      /* the sidebar changing size (minimize, font load) re-measures without animating */
      if (window.ResizeObserver) new ResizeObserver(() => { const c = current(); if (c) place(c, false); }).observe(nav);
    }

    /* Clicking a sidebar link: slide the highlight, fade the page out, then go. */
    document.getElementById('sidebar').addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
      const href = a.getAttribute('href');
      const tab = nav.querySelector('a[href="' + href + '"]');
      if (href === location.pathname.split('/').pop()) {
        e.preventDefault();
        if (href === 'add-report.html' && document.querySelector('.done:not([hidden])')) location.href = href;   /* after filing: open a fresh form */
        return;
      }   /* already on this page */
      try { if (ind.dataset.h) sessionStorage.setItem(NAV_KEY, JSON.stringify({ y: +ind.dataset.y, h: +ind.dataset.h, t: Date.now() })); } catch (err) { /* ignore */ }
      if (reduce) return;
      e.preventDefault();
      if (tab) { current()?.removeAttribute('aria-current'); tab.setAttribute('aria-current', 'page'); place(tab, true); }
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