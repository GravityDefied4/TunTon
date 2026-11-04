const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/reportsController');
const claims = require('../controllers/claimsController');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

/* Public home-page preview: the only report endpoint that needs no login. It returns a trimmed projection
   (no owner id, exact pin, markings or description) and is rate limited per IP. Must stay above requireAuth. */
const previewLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many requests. Try again shortly.' } });
router.get('/public', previewLimiter, ctrl.publicPreview);

router.use(requireAuth);

router.get('/lookups', ctrl.lookups);   // Species, breeds, colors, barangays, limits (must stay above /:id)
router.post('/', upload.reportPhotos, ctrl.create);   // Create report (multipart with photos)
router.get('/', ctrl.list);   // List with filters (type, species, status, radius)
router.get('/mine', ctrl.mine);   // Own reports (must stay above /:id)
router.get('/:id', ctrl.getOne);   // Details (contact info hidden)
router.get('/:id/claims', claims.forReport);   // Claims on this report (everyone sees pending + approved; contact details only for the owner and the claimant)
router.put('/:id', upload.reportPhotos, ctrl.update);   // Update own report (owner only; may add photos)
router.patch('/:id/status', ctrl.setStatus);   // Close or resolve (owner only)
router.delete('/:id', ctrl.remove);   // Permanently delete (owner only; its claims are deleted with it)

module.exports = router;