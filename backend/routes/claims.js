const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/claimsController');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

/* Sending claims is limited so nobody can flood a report. */
const sendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many claims. Try again later.' } });

router.get('/mine', ctrl.mine);   // Claims I sent (must stay above /:id)
router.post('/', sendLimiter, upload.claimPhotos, ctrl.create);   // "I found this pet" / "This is my pet" on an existing report
router.get('/:id', ctrl.getOne);   // One claim (claimant, owner of the report, admin)
router.put('/:id', upload.claimPhotos, ctrl.update);   // Edit my claim while it is pending
router.delete('/:id', ctrl.withdraw);   // Withdraw my claim while it is pending
router.patch('/:id/decision', ctrl.decide);   // Approve or reject (owner of the report only)

module.exports = router;