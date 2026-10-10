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

    /* highlight the link for the current page */
    const here = location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.side-nav a').forEach(a => {
      if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
    });
    return true;
  } catch (err) {
    console.error('Could not load sidebar.html. Open the site through a local server (Live Server), not file://.', err);
    return false;
  }
})();
