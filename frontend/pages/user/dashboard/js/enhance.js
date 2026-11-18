/* =========================================================
   Shared UI helpers for every dashboard page (loaded by sidebar.js):
   - toast(message, type)    small confirmation / error pop-up
   - bottom navigation bar   thumb-friendly tabs on phones and tablets
   - offline banner          tells people when the connection drops
   ========================================================= */
(function () {
  const host = document.createElement('div');
  host.className = 'toast-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.append(host);

  window.toast = function (message, type) {
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'error' ? ' toast--error' : '');
    t.textContent = message;
    host.append(t);
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); }, 2600);
  };

  /* Bottom nav: built from the sidebar links so the menu stays defined in one place (sidebar.html). */
  const links = [...document.querySelectorAll('.side-nav a')];
  if (links.length) {
    const nav = document.createElement('nav');
    nav.className = 'bnav';
    nav.setAttribute('aria-label', 'Main');
    const short = { 'All reports': 'Reports', 'Add pet report': 'Report', 'My profile': 'Profile' };
    nav.innerHTML = links.map(a => {
      const svg = a.querySelector('svg')?.outerHTML || '';
      const label = a.querySelector('.label')?.textContent.trim() || a.title;
      const add = /add-report/.test(a.getAttribute('href'));
      const cur = a.getAttribute('aria-current') ? ' aria-current="page"' : '';
      return `<a href="${a.getAttribute('href')}"${cur}${add ? ' class="bnav-add"' : ''}>${add ? `<i>${svg}</i>` : svg}<span>${short[label] || label}</span></a>`;
    }).join('');
    document.body.append(nav);
  }

  /* Offline banner */
  const banner = document.createElement('div');
  banner.className = 'net-banner';
  banner.hidden = navigator.onLine !== false;
  banner.textContent = 'You are offline. Some things may not update until you reconnect.';
  document.querySelector('.dash-main')?.prepend(banner);
  window.addEventListener('offline', () => { banner.hidden = false; });
  window.addEventListener('online', () => { banner.hidden = true; window.toast('Back online'); });
})();
