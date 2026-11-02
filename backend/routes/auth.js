const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many attempts. Try again later.' } });

/* Password guessing gets its own, tighter limit; successful logins do not count against it. */
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many failed attempts. Try again in 15 minutes.' } });

router.get('/config', ctrl.config);
router.post('/google', limiter, ctrl.google);   // { credential, mode: 'login' | 'signup' }
router.post('/register', limiter, ctrl.register);   // { name, email, password }
router.post('/login', loginLimiter, ctrl.login);    // { email, password }
router.get('/me', requireAuth, ctrl.me);
router.post('/logout', ctrl.logout);

module.exports = router;
