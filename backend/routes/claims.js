const express = require('express');
const ctrl = require('../controllers/claimsController');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.post('/', ctrl.create);   // Start a claim on a match (owner of lost report)
router.post('/:id/proofs', upload.proofFiles, ctrl.addProofs);   // Upload proof files, max 3 submissions (claimant)
router.get('/:id/proofs/:proofId/file', ctrl.proofFile);   // Private proof file (claimant, finder, admin)
router.get('/:id', ctrl.getOne);   // View claim status (involved users)
router.patch('/:id/decision', ctrl.decide);   // Approve or reject (finder or admin)
router.get('/:id/contact', ctrl.contact);   // Released contact info, ONLY if approved

module.exports = router;
