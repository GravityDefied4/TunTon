/* Web Push notifications: an alert on the user's phone or computer even when TunTon is closed.

   Three events send a push, the same three moments the app already e-mails about (plus the owner's decision):
     1. someone sent a claim on YOUR report                      -> notifyClaim()      (to the report's owner)
     2. the owner approved or rejected a claim that YOU sent      -> notifyDecisions()  (to the claimant)
     3. a new report strongly matches YOUR report (score 80+)     -> notifyMatch()      (to the report's owner)

   How it works:
     - The browser (frontend/js/push.js + frontend/sw.js) subscribes and POSTs the subscription to /api/push/subscribe.
       It is kept in push_subscriptions, one row per device.
     - sendToUser() sends a message to every device of a user. The push service (Google / Mozilla / Apple / Microsoft)
       holds it for PUSH_TTL_SECONDS if the device is offline and delivers it when the device reconnects.
     - Subscriptions that the push service reports as gone (404 / 410) are deleted automatically.
     - A push problem must never break a request, so every notify*() function catches its own errors.
       Call them AFTER the database transaction commits, and do not await them in the request.

   Setup (.env):  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com or your https PUBLIC_URL)
   Make the keys once with:  npx web-push generate-vapid-keys   (never change them later: every device would stop receiving).
   Without keys the feature is simply off (a warning is printed at start-up). */
const crypto = require('crypto');
const pool = require('../db/pool');

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 && v !== '' && v != null ? Number(v) : d);
const CFG = {
  ttlSeconds: num(process.env.PUSH_TTL_SECONDS, 3 * 24 * 60 * 60),        // how long the push service holds a message for an offline device
  maxDevices: Math.max(1, Math.floor(num(process.env.PUSH_MAX_DEVICES_PER_USER, 10)))   // oldest devices are dropped beyond this
};

/* Tests replace these (see tests/push.test.js). `send` = function(subscription, body, options). */
const deps = { db: pool, send: null };

/* ---- Subscription endpoint check (security) ----
   The server POSTs to whatever endpoint URL a subscription contains, so a user could otherwise make the server call any
   address (SSRF). Only the real browser push services are accepted. Add others with PUSH_EXTRA_HOSTS=host1,host2. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
function isPushEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const hosts = [...PUSH_HOSTS, ...String(process.env.PUSH_EXTRA_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)];
  const h = u.hostname.toLowerCase();
  return hosts.some(x => h === x || h.endsWith('.' + x));
}

/* ---- web-push, loaded on first use (same pattern as nodemailer in notifier.js) ---- */
let wp;   // undefined = not tried yet, null = not available
function webpush() {
  if (wp !== undefined) return wp;
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, PUBLIC_URL } = process.env;
  const subject = process.env.VAPID_SUBJECT || (/^https:/i.test(PUBLIC_URL || '') ? PUBLIC_URL : '');
  if (!pub || !priv || !subject) return (wp = null);
  try {
    wp = require('web-push');
    wp.setVapidDetails(subject, pub, priv);
  } catch (e) {
    console.error(/Cannot find module/.test(e.message) ? '[push] web-push is not installed. Run: npm install web-push' : `[push] VAPID setup failed: ${e.message}`);
    wp = null;
  }
  return wp;
}
const enabled = () => Boolean(deps.send || webpush());
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

/* Called once from server.js, like notifier.startWorker(). */
function announce() {
  if (enabled()) console.log(`[push] web push is on (messages are held up to ${Math.round(CFG.ttlSeconds / 3600)} h for offline devices)`);
  else console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not set: push notifications are off. See NOTIFICATIONS.md.');
}

/* ---- Subscriptions ---- */
const hash = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex');

/* One row per device. A device that logs in as someone else is moved to the new account (same endpoint, new user). */
async function saveSubscription(userId, sub, userAgent) {
  const db = deps.db;
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth = VALUES(auth),
                             user_agent = VALUES(user_agent), updated_at = NOW()`,
    [userId, sub.endpoint, hash(sub.endpoint), sub.keys.p256dh, sub.keys.auth, String(userAgent || '').slice(0, 255) || null]);
  /* Keep only the newest maxDevices devices of this user. */
  await db.query(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND subscription_id NOT IN (
       SELECT subscription_id FROM (SELECT subscription_id FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, subscription_id DESC LIMIT ?) keep)`,
    [userId, userId, CFG.maxDevices]);
}

/* Only the owner of the subscription can remove it. */
const removeSubscription = (userId, endpoint) =>
  deps.db.query('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?', [hash(endpoint), userId]);

/* ---- Sending ---- */
function sender() {
  if (deps.send) return deps.send;
  const lib = webpush();
  return lib ? (sub, body, opts) => lib.sendNotification(sub, body, opts) : null;
}

/* Send one payload { title, body, url, tag } to every device of a user. Suspended users get nothing.
   Never throws. Returns { sent, removed }. */
async function sendToUser(userId, payload) {
  const out = { sent: 0, removed: 0 };
  try {
    const send = sender();
    if (!send) return out;
    const [rows] = await deps.db.query(
      `SELECT s.subscription_id, s.endpoint, s.p256dh, s.auth
         FROM push_subscriptions s JOIN users u ON u.user_id = s.user_id
        WHERE s.user_id = ? AND u.status = 'active'`, [userId]);
    const body = JSON.stringify(payload);
    await Promise.all(rows.map(async row => {
      try {
        await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, { TTL: CFG.ttlSeconds, urgency: 'high' });
        out.sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {   // the user revoked permission or the browser dropped it
          await deps.db.query('DELETE FROM push_subscriptions WHERE subscription_id = ?', [row.subscription_id]);
          out.removed++;
        } else console.error(`[push] could not send to subscription ${row.subscription_id}:`, e.statusCode || e.message);
      }
    }));
  } catch (e) { console.error('[push] sendToUser failed:', e.message); }
  return out;
}

/* ---- Messages (pure: unit-tested). Same wording as the in-app bell. No contact details: a lock screen is public. ---- */
const shorten = (t, n) => { const x = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '\u2026' : x; };
const firstName = full => String(full || '').trim().split(/\s+/)[0] || 'A user';
const petOf = name => shorten(name, 40) || 'your pet';
const reportUrl = id => `/pages/user/dashboard/report?id=${encodeURIComponent(id)}`;

/* claim: { claim_id, claimant_name, report_id, report_type, pet_name } */
function claimMessage(claim) {
  const lost = claim.report_type === 'lost';
  return {
    title: lost ? 'Someone may have found your pet' : 'Someone says this is their pet',
    body: `${firstName(claim.claimant_name)} responded to your ${lost ? 'lost' : 'found'} report for ${petOf(claim.pet_name)}.`,
    url: reportUrl(claim.report_id), tag: `claim-${claim.claim_id}`
  };
}

/* claim: { claim_id, status: 'approved' | 'rejected', report_id, pet_name } */
function decisionMessage(claim) {
  const ok = claim.status === 'approved';
  return {
    title: ok ? 'Your response was approved' : 'Your response was marked not a match',
    body: (ok ? 'The owner approved your response for ' : 'The owner did not match your response for ') + petOf(claim.pet_name) + '.',
    url: reportUrl(claim.report_id), tag: `decision-${claim.claim_id}`
  };
}

/* m: { owner_report_id, owner_type, new_type, pet_name, score, label, lost_id, found_id } */
function matchMessage(m) {
  return {
    title: `${m.label} match found`,
    body: `A new ${m.new_type === 'lost' ? 'lost' : 'found'} report looks like a ${String(m.label).toLowerCase()} match (${Math.round(m.score)}%) for your ${m.owner_type === 'lost' ? 'lost' : 'found'} report "${petOf(m.pet_name)}".`,
    url: `/pages/user/dashboard/matching?report=${encodeURIComponent(m.owner_report_id)}`, tag: `match-${m.lost_id}-${m.found_id}`
  };
}

/* ---- Event hooks (call after the transaction commits; do not await) ---- */

/* Someone sent a claim: tell the owner of the claimed report. */
async function notifyClaim(claimId) {
  try {
    const [[c]] = await deps.db.query(
      `SELECT c.claim_id, cu.full_name AS claimant_name, r.report_id, r.user_id AS owner_id, r.report_type, r.pet_name
         FROM claims c JOIN users cu ON cu.user_id = c.claimant_user_id JOIN pet_reports r ON r.report_id = c.report_id
        WHERE c.claim_id = ?`, [claimId]);
    if (c) await sendToUser(c.owner_id, claimMessage(c));
  } catch (e) { console.error(`[push] could not notify claim ${claimId}:`, e.message); }
}

/* The owner decided: tell each claimant whose claim is now approved or rejected (ids = claim ids). */
async function notifyDecisions(claimIds) {
  try {
    if (!claimIds || !claimIds.length) return;
    const [rows] = await deps.db.query(
      `SELECT c.claim_id, c.claimant_user_id, c.status, r.report_id, r.pet_name
         FROM claims c JOIN pet_reports r ON r.report_id = c.report_id WHERE c.claim_id IN (?)`, [claimIds]);
    await Promise.all(rows.filter(r => r.status === 'approved' || r.status === 'rejected').map(r => sendToUser(r.claimant_user_id, decisionMessage(r))));
  } catch (e) { console.error('[push] could not notify decisions:', e.message); }
}

/* A strong match was just queued for the owner of ownerReportId (matchRunner calls this only when the e-mail was queued,
   so a pair of reports alerts an owner once, never again when matching re-runs). */
async function notifyMatch({ ownerReportId, newReportId, lostId, foundId, score, label }) {
  try {
    const [[o]] = await deps.db.query(
      `SELECT r.report_id, r.user_id, r.report_type, r.pet_name, n.report_type AS new_type
         FROM pet_reports r JOIN pet_reports n ON n.report_id = ? WHERE r.report_id = ?`, [newReportId, ownerReportId]);
    if (o) await sendToUser(o.user_id, matchMessage({ owner_report_id: o.report_id, owner_type: o.report_type, new_type: o.new_type, pet_name: o.pet_name, score, label, lost_id: lostId, found_id: foundId }));
  } catch (e) { console.error('[push] could not notify match:', e.message); }
}

module.exports = {
  CFG, _deps: deps, enabled, publicKey, announce, isPushEndpoint,
  saveSubscription, removeSubscription, sendToUser,
  claimMessage, decisionMessage, matchMessage, notifyClaim, notifyDecisions, notifyMatch
};
