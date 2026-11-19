/* Scheduled work for serverless hosting (Vercel). A serverless function only runs while a request is being handled,
   so the setInterval timers in notifier.startWorker() and suspensions.startSweeper() never fire there.
   Vercel Cron (see vercel.json) calls this endpoint instead, and each call does one round of what the timers do.

   Security: Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically when the CRON_SECRET environment
   variable is set. Without CRON_SECRET the endpoint refuses to run, so nobody can trigger it. */
const crypto = require('crypto');
const express = require('express');
const notifier = require('../services/notifier');
const suspensions = require('../services/suspensions');

const router = express.Router();

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

router.get('/send-emails', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ success: false, data: null, message: 'CRON_SECRET is not set.' });
  const given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(given, secret)) return res.status(401).json({ success: false, data: null, message: 'Unauthorized.' });

  try {
    const lifted = await suspensions.liftExpired();   // queues the "account active again" e-mails
    const mail = await notifier.sendBatch();           // { sent, failed, pending }
    res.json({ success: true, data: { liftedSuspensions: lifted, ...mail }, message: 'ok' });
  } catch (e) {
    console.error('[cron] failed:', e.message);
    res.status(500).json({ success: false, data: null, message: 'Cron run failed.' });
  }
});

module.exports = router;