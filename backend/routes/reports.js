const express = require('express');
const ctrl = require('../controllers/reportsController');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/lookups', ctrl.lookups);   // Species, breeds, colors, barangays, limits (must stay above /:id)
router.post('/', upload.reportPhotos, ctrl.create);   // Create report (multipart with photos)
router.get('/', ctrl.list);   // List with filters (type, species, status, radius)
router.get('/mine', ctrl.mine);   // Own reports (must stay above /:id)
router.get('/:id', ctrl.getOne);   // Details (contact info hidden)
router.put('/:id', upload.reportPhotos, ctrl.update);   // Update own report (owner only; may add photos)
router.patch('/:id/status', ctrl.setStatus);   // Close or resolve (owner only)

module.exports = router;
