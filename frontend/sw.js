/* =========================================================
   TunTon service worker: receives Web Push messages and shows them,
   even when no TunTon tab is open (and the browser window is closed,
   on phones and on most desktops).

   IMPORTANT: this file must be served from the site ROOT (/sw.js).
   A service worker can only control pages inside its own folder, and
   the dashboard pages live under /pages/..., so it cannot sit in js/.
   ========================================================= */
'use strict';

const ICON = '/assets/icons/icon-192.png';
const BADGE = '/assets/icons/badge-96.png';
const FALLBACK_URL = '/pages/user/dashboard/dashboard';   /* the server uses clean URLs (no .html) */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* A push arrives. Browsers require a visible notification for every push. */
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { body: event.data ? event.data.text() : '' }; }

  const title = d.title || 'TunTon';
  event.waitUntil((async () => {
    /* If TunTon is open and in front, the bell updates itself: no pop-up on top of the page the person is looking at. */
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watching = tabs.filter(t => t.visibilityState === 'visible' && t.focused);
    if (watching.length) { watching.forEach(t => t.postMessage({ type: 'push-received' })); return; }

    await self.registration.showNotification(title, {
      body: d.body || '',
      icon: d.icon || ICON,
      badge: BADGE,
      tag: d.tag || undefined,          /* same tag = replaces the older one instead of stacking */
      renotify: !!d.tag,
      data: { url: d.url || FALLBACK_URL }
    });
    tabs.forEach(t => t.postMessage({ type: 'push-received' }));   /* background tabs refresh their bell too */
  })());
});

/* The user taps the notification: focus an open TunTon tab, else open a new one. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || FALLBACK_URL, self.location.origin).href;

  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      if (new URL(tab.url).origin === self.location.origin && 'focus' in tab) {
        await tab.focus();
        if ('navigate' in tab) { try { await tab.navigate(target); } catch (e) { /* ignore */ } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

/* The browser rotated the subscription: get a new one and give it to the server.
   (No login token is available here, so the page re-syncs it on the next visit as well.) */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const old = event.oldSubscription;
      const key = old?.options?.applicationServerKey;
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'push-resubscribed', subscription: sub.toJSON() }));
    } catch (e) { /* the page will re-subscribe next time it opens */ }
  })());
});
