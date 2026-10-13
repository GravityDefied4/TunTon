const express = require('express');
const ctrl = require('../controllers/adminController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/users', ctrl.users);   // List users
router.patch('/users/:id/status', ctrl.setUserStatus);   // Suspend or reactivate
router.get('/reports', ctrl.reports);   // All reports with filters
router.patch('/reports/:id/remove', ctrl.removeReport);   // Remove inappropriate report
router.get('/claims', ctrl.claims);   // Review claims and disputes
router.get('/stats', ctrl.stats);   // Dashboard numbers
router.get('/logs', ctrl.logs);   // Audit trail

module.exports = router;
