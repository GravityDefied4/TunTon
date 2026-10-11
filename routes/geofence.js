const express = require('express');
const ctrl = require('../controllers/geofenceController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/nearby', ctrl.nearby);   // ?lat=&lng=&radius= (radius 1 to 5, inside Dagupan)
router.get('/barangays', ctrl.barangays);   // Barangay list and boundaries
router.get('/barangay/:id/reports', ctrl.barangayReports);   // Reports inside a zone

module.exports = router;
