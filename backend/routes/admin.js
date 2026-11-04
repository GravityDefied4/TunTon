const express = require('express');
const ctrl = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));   // every admin endpoint: logged in AND role = admin

router.get('/stats', ctrl.stats);                          // Dashboard numbers
router.get('/users', ctrl.users);                          // ?q=&role=&status=
router.patch('/users/:id/status', ctrl.setUserStatus);     // { status: 'active' | 'suspended', reason? }
router.get('/reports', ctrl.reports);                      // All reports incl. removed (must stay above /reports/:id)
router.get('/reports/:id', ctrl.reportDetail);             // Full read-only moderation view
router.patch('/reports/:id/flag', ctrl.flagReport);        // { type: 'fraud' | 'ai_generated', reason }
router.patch('/reports/:id/remove', ctrl.removeReport);    // { reason }
router.patch('/reports/:id/restore', ctrl.restoreReport);
router.get('/reports/:id/claims', ctrl.reportClaims);      // Every claim on one report, rejected ones included
router.get('/claims', ctrl.claims);                        // ?status=&q=
router.get('/logs', ctrl.logs);                            // Audit trail

module.exports = router;