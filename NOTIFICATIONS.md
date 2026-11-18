# Notifications (bell icon)

Files added: `pages/user/dashboard/js/notifications.js`, `pages/user/dashboard/css/notifications.css`.
Changed: every dashboard page gets one extra line after common.js:
`<script src="js/notifications.js"></script>`

Works with the existing API only (reports, /claims/mine, /reports/:id/claims). No backend change needed.

Settings at the top of notifications.js: NEARBY_KM (3), NEARBY_DAYS (3), REFRESH_MS (2 min).

Limits of the frontend-only version:
- Updates while a TunTon tab is open (checks every 2 min and when you return to the tab).
- "Read" state is stored per browser, not per account on the server.
- "Nearby" uses the user's current location (GPS or IP estimate); no location = no nearby alerts.
- No alerts when the site is closed: see "Push notifications" below (needs the backend-push module).

# Push notifications (site closed / phone locked / offline)

What the user gets: a phone or desktop alert even when no TunTon tab is open. Three events send one:
1. someone sent a claim on your report (to the report's owner)
2. the owner approved or rejected a claim you sent (to the claimant)
3. a new report strongly matches yours, score 80+ (to the report's owner, once per pair of reports, same rule as the e-mail)

Tapping the alert opens the report (or the Matching tab). If the TunTon tab is already open and in front, no pop-up is shown;
the bell just updates. If the phone is offline, the push service holds the alert (PUSH_TTL_SECONDS, default 3 days) and delivers it on reconnect.

## Setup (once)
1. `npm install web-push`
2. `npx web-push generate-vapid-keys`, then add to `.env` (never change the keys later, or every device stops receiving):
       VAPID_PUBLIC_KEY=...
       VAPID_PRIVATE_KEY=...
       VAPID_SUBJECT=mailto:you@yourdomain.com
   Optional: PUSH_TTL_SECONDS (259200), PUSH_MAX_DEVICES_PER_USER (10), PUSH_EXTRA_HOSTS (extra push-service hosts, comma separated).
3. Create the table: new database -> `backend/db/schema.sql`; existing database -> run `backend/db/push_subscriptions.sql` once.
4. Restart. The console prints `[push] web push is on` (or a warning saying which keys are missing).
5. HTTPS is required by browsers (localhost is fine). Use your https tunnel or SSL_KEY_FILE / SSL_CERT_FILE.
Then each user opens the bell and taps "Turn on" (per device).

## Files
Frontend (new): `sw.js` (must stay in the site root so it covers /pages/...), `manifest.webmanifest`, `js/push.js`, `assets/icons/*`.
Frontend (changed): `pages/user/dashboard/js/notifications.js` (Turn on / Turn off row, live refresh), `pages/user/dashboard/js/common.js` (logout removes this device), `pages/user/dashboard/css/notifications.css`.
Backend (new): `services/push.js` (sending, messages, hooks), `controllers/pushController.js`, `routes/push.js`, `db/push_subscriptions.sql`, `tests/push.test.js`.
Backend (changed): `server.js` (mounts /api/push, serves /sw.js with no-cache), `controllers/claimsController.js` (claim sent / decided),
`services/matchRunner.js` (strong match), `db/schema.sql` (push_subscriptions table).

## Notes
- Alerts are sent after the database commit and are never awaited, so a push problem cannot fail a claim or a report.
- Suspended users receive nothing; expired subscriptions (404/410 from the push service) are deleted automatically.
- Security: the server only sends to real push-service hosts (Google, Mozilla, Apple, Microsoft), so a user cannot make it call another address.
- Logging out removes that device from the account, so a shared phone does not keep showing the previous user's alerts.
- iPhone/iPad: push only works after Share > Add to Home Screen (iOS 16.4+); the bell panel shows this hint.
- "Reports near you" stays in-app only: the server does not store user locations.

# Long text on cards
`midEllipsis(text, max, tail)` and `short(text, max, tail)` in js/common.js shorten long values by replacing the middle with "..." and keeping the end (a file's extension is always kept). The full text stays in the hover tooltip. Used for photo file names, pet and person names, email, other contact, Facebook link.

# Photo thumbnails (report details page)
css/detail.css (section "v10") and js/report.js: equal 3:2 tiles (6 across, 4 on phones) lined up with the photo card, the current photo has a green ring, the others are dimmed, many photos scroll sideways and snap, and Left/Right arrow keys move between photos.
