const express = require('express');
const ctrl = require('../controllers/adminController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/users', ctrl.users);   // List users
router.patch('/users/:id/status', ctrl.setUserStatus);   // Suspend or reactivate
router.get('/reports', ctrl.reports);   // All reports with filters
router.get('/reports/:id', ctrl.reportDetail); // Read-only full report preview for moderation
router.patch('/reports/:id/flag', ctrl.flagReport); // Record a moderation flag without editing the report
router.patch('/reports/:id/remove', ctrl.removeReport);   // Soft-hide report
router.patch('/reports/:id/restore', ctrl.restoreReport); // Restore hidden report
router.get('/reports/:id/claims', ctrl.reportClaims);   // Claims on one report (existing rows only)
router.get('/claims', ctrl.claims);   // All existing claims
router.get('/stats', ctrl.stats);   // Dashboard numbers
router.get('/logs', ctrl.logs);   // Audit trail

module.exports = router;