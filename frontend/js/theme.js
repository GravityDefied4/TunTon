/* =========================================================
   TunTon theme (light / dark).
   Load in <head> so the right theme is set before the page paints.
   Uses the saved choice, otherwise the device setting.
   Any element with [data-theme-toggle] switches it; elements with
   [data-theme-label] get "Dark mode" / "Light mode" text.
   Listen for the "tunton:themechange" event to react (e.g. map tiles).
   ========================================================= */
(function () {
  var KEY = 'tunton_theme', root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var saved = function () { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } };
  var current = function () { return saved() || (mq && mq.matches ? 'dark' : 'light'); };

  function sync() {
    var dark = root.dataset.theme === 'dark', next = dark ? 'Light mode' : 'Dark mode';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(dark));
      b.setAttribute('aria-label', 'Switch to ' + next.toLowerCase());
      b.title = 'Switch to ' + next.toLowerCase();
    });
    document.querySelectorAll('[data-theme-label]').forEach(function (l) { l.textContent = next; });
  }
  function apply(theme) {
    root.dataset.theme = theme;
    sync();
    window.dispatchEvent(new CustomEvent('tunton:themechange', { detail: { theme: theme } }));
  }

  root.dataset.theme = current();   /* before first paint */

  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-theme-toggle]')) return;
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (err) { /* storage unavailable: applies for this visit only */ }
    apply(next);
  });
  if (mq) (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () { if (!saved()) apply(current()); });
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(current()); });   /* other tab */
  document.addEventListener('DOMContentLoaded', sync);
  window.TunTonTheme = { sync: sync };
})();