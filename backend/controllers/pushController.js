/* Push subscriptions: the browser registers (or removes) the device it wants alerts on.
   Sending lives in services/push.js. Routes only map URLs (plan rule 2). */
const { wrap } = require('../middleware/errorHandler');
const v = require('../middleware/validate');
const push = require('../services/push');

/* GET /api/push/public-key -> { publicKey }  The browser needs it to create a subscription. */
exports.publicKey = wrap(async (req, res) => {
  if (!push.enabled()) return res.fail(503, 'Push notifications are not set up on this server.');
  res.ok({ publicKey: push.publicKey() });
});

/* POST /api/push/subscribe  { subscription: { endpoint, keys: { p256dh, auth } } }  (what PushSubscription.toJSON() gives) */
exports.subscribe = wrap(async (req, res) => {
  if (!push.enabled()) return res.fail(503, 'Push notifications are not set up on this server.');
  const sub = req.body?.subscription;
  const ok = sub && typeof sub.endpoint === 'string' && sub.endpoint.length <= 1000 &&
    typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length <= 255 && typeof sub.keys?.auth === 'string' && sub.keys.auth.length <= 255;
  if (!ok) throw v.bad('That is not a valid push subscription.');
  if (!push.isPushEndpoint(sub.endpoint)) throw v.bad('That push service is not supported.');
  await push.saveSubscription(req.user.user_id, sub, req.get('user-agent'));
  res.status(201);
  res.ok({ subscribed: true }, 'Push alerts are on for this device.');
});

/* POST /api/push/unsubscribe  { endpoint }  (POST, not DELETE: it is also sent with fetch keepalive when logging out) */
exports.unsubscribe = wrap(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 1000) throw v.bad('endpoint is required.');
  await push.removeSubscription(req.user.user_id, endpoint);
  res.ok({ subscribed: false }, 'Push alerts are off for this device.');
});
