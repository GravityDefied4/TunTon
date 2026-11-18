/* =========================================================
   TunTon Web Push (browser side).

   Loaded by notifications.js on every dashboard page. Needs common.js (authFetch, sess).
   Public API:  window.TuntonPush = { supported, status(), enable(), disable(), sync(), forgetOnLogout() }
   status() resolves to: 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'
   ========================================================= */
(function () {
  'use strict';

  const SW_URL = '/sw.js';       /* must be at the site root, see sw.js */
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  /* iPhone / iPad only allow push for a site added to the Home Screen (iOS 16.4+). */
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /* The manifest lets the site be installed as an app (needed on iOS, nice on Android). */
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement('link');
    l.rel = 'manifest'; l.href = '/manifest.webmanifest';
    document.head.appendChild(l);
  }

  const b64ToBytes = s => {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };

  const registration = () => navigator.serviceWorker.register(SW_URL).then(() => navigator.serviceWorker.ready);

  /* The API answers { success, data, message }; show its message when something goes wrong. */
  const apiMessage = async (res, fallback) => { try { return (await res.json()).message || fallback; } catch (e) { return fallback; } };

  async function publicKey() {
    const res = await authFetch('/push/public-key');
    if (!res.ok) throw new Error(res.status === 503 ? 'Push alerts are not set up on the server yet.' : await apiMessage(res, 'Could not start push alerts'));
    return (await res.json()).data?.publicKey;
  }

  const sendToServer = sub => authFetch('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub })
  });

  async function status() {
    if (!supported) return (isIOS && !isStandalone) ? 'needs-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') return 'off';
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_URL);
      return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
    } catch (e) { return 'off'; }
  }

  /* Must be called from a click (browsers block permission prompts otherwise). */
  async function enable() {
    if (!supported) throw new Error('This browser does not support push notifications');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications were not allowed');
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(await publicKey()) });
    const res = await sendToServer(sub);
    if (!res.ok) {
      await sub.unsubscribe().catch(() => {});   /* do not keep a device the server did not accept */
      throw new Error(await apiMessage(res, 'Could not save the subscription'));
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    try { await authFetch('/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch (e) { /* offline */ }
    await sub.unsubscribe();
  }

  /* On every page load: if push is already on, make sure the server has this browser under the
     CURRENT account (covers a rotated subscription, or another person logging in on this device). */
  async function sync() {
    if (!supported || Notification.permission !== 'granted') return;
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sendToServer(sub);
    } catch (e) { /* offline: try again next visit */ }
  }

  /* Called by logout(): stop this device from receiving the previous account's alerts. */
  function forgetOnLogout() {
    if (!supported) return;
    navigator.serviceWorker.getRegistration(SW_URL).then(reg => reg?.pushManager.getSubscription()).then(sub => {
      if (!sub) return;
      try {
        fetch((window.TUNTON?.API_BASE ?? '/api') + '/push/unsubscribe', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess?.token },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      } catch (e) { /* ignore */ }
      sub.unsubscribe().catch(() => {});
    }).catch(() => {});
  }

  if (supported) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'push-resubscribed' && e.data.subscription) sendToServer(e.data.subscription).catch(() => {});
    });
    registration().then(sync).catch(() => {});
  }

  window.TuntonPush = { supported, status, enable, disable, sync, forgetOnLogout };
})();
