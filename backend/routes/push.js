const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/pushController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* Subscribing writes to the database, so it is limited (a normal user subscribes once per device). */
const subscribeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many requests. Try again later.' } });

router.get('/public-key', ctrl.publicKey);
router.post('/subscribe', subscribeLimiter, ctrl.subscribe);     // { subscription }
router.post('/unsubscribe', ctrl.unsubscribe);                   // { endpoint }

module.exports = router;
