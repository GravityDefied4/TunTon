const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many attempts. Try again later.' } });

router.get('/config', ctrl.config);
router.post('/google', limiter, ctrl.google);   // { credential, mode: 'login' | 'signup' }
router.get('/me', requireAuth, ctrl.me);
router.post('/logout', ctrl.logout);

module.exports = router;
