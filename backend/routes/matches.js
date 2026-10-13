const express = require('express');
const ctrl = require('../controllers/matchesController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/matching/run/:reportId', ctrl.run);   // P4: recompute matches for a report (system or owner)
router.get('/matches/mine', ctrl.mine);   // Matches for my reports
router.get('/matches/:id', ctrl.getOne);   // Match details side by side (involved users)
router.patch('/matches/:id/dismiss', ctrl.dismiss);   // Dismiss a suggestion (involved users)

module.exports = router;
