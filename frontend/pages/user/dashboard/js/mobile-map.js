/* =========================================================
   Phone dashboard: the results panel becomes a bottom sheet.
   - a handle shows "N reports" (and the location status); tap or swipe it to open / close
   - it opens by itself when a report is picked or the search box is used
   - tapping empty map closes it
   Only the look on phones (css/mobile-map.css) depends on this; on desktop the handle is hidden
   and nothing here changes the layout. Load AFTER dashboard.js.
   ========================================================= */
(function () {
  'use strict';
  const side = document.getElementById('side'), body = document.getElementById('side-body');
  if (!side || !body) return;
  const mq = window.matchMedia('(max-width: 640px)');

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'sheet-grip';
  grip.setAttribute('aria-expanded', 'false');
  grip.setAttribute('aria-controls', 'side-body');
  grip.innerHTML = '<span class="sheet-bar" aria-hidden="true"></span><b class="sheet-count">Finding reports&hellip;</b><span class="sheet-sub"></span>';
  side.prepend(grip);
  const countEl = grip.querySelector('.sheet-count'), subEl = grip.querySelector('.sheet-sub');
  const status = document.getElementById('status');

  const locate = document.getElementById('locate');
  if (locate) { locate.setAttribute('aria-label', 'My location'); locate.title = 'My location'; }

  const isOpen = () => side.classList.contains('is-open');
  const set = open => {
    side.classList.toggle('is-open', open);
    document.body.classList.toggle('sheet-open', open);
    grip.setAttribute('aria-expanded', String(open));
  };
  const inDetail = () => !!body.querySelector('#side-back');

  const sync = () => {
    const detail = inDetail(), small = body.querySelector('.side-title small');
    side.classList.toggle('is-detail', detail);
    countEl.textContent = detail ? 'Report details'
      : small ? small.textContent + (small.textContent.trim() === '1' ? ' report' : ' reports')
      : body.querySelector('.side-empty') ? 'No reports here' : 'Finding reports\u2026';
    subEl.textContent = detail ? '' : (status ? status.textContent : '');
  };

  /* After a report opens in the sheet, slide the map so its pin sits in the visible strip above the sheet */
  const reveal = () => {
    try {
      if (!mq.matches || typeof map === 'undefined' || typeof markers === 'undefined' || !selectedId || !markers[selectedId]) return;
      const mapTop = map.getContainer().getBoundingClientRect().top;
      const sheetTop = side.getBoundingClientRect().top - mapTop;
      const want = (120 + sheetTop) / 2;                    /* middle of the free area under the search + chips */
      const dy = map.latLngToContainerPoint(markers[selectedId].getLatLng()).y - want;
      if (Math.abs(dy) > 8) map.panBy([0, dy]);
    } catch (e) { /* the map is still starting: nothing to move */ }
  };

  let wasDetail = false;
  new MutationObserver(() => {
    const d = inDetail();
    sync();
    if (mq.matches && d && !wasDetail) { set(true); setTimeout(reveal, 360); }
    wasDetail = d;
  }).observe(body, { childList: true });
  if (status) new MutationObserver(sync).observe(status, { childList: true, characterData: true, subtree: true });
  sync();

  /* Handle: tap toggles, swipe up opens, swipe down closes (keyboard Enter / Space fire a click with detail 0) */
  let y0 = null;
  grip.addEventListener('pointerdown', e => { y0 = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
  grip.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    set(dy < -24 ? true : dy > 24 ? false : !isOpen());
  });
  grip.addEventListener('pointercancel', () => { y0 = null; });
  grip.addEventListener('click', e => { if (e.detail === 0) set(!isOpen()); });

  /* Typing in the search box shows the matches; a tap on empty map closes the sheet */
  const q = document.getElementById('q');
  if (q) q.addEventListener('input', () => { if (mq.matches && !isOpen()) set(true); });
  const mapEl = document.getElementById('map');
  if (mapEl) mapEl.addEventListener('click', e => {
    if (!mq.matches || e.target.closest('.leaflet-marker-icon, .leaflet-control')) return;
    if (isOpen()) set(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && mq.matches && isOpen()) { set(false); grip.focus(); } });
  const leave = e => { if (!e.matches) set(false); };
  mq.addEventListener ? mq.addEventListener('change', leave) : mq.addListener(leave);
})();
