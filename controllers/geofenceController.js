/* geofence controller: business logic lives here, routes only map URLs (plan rule 2).
   Every handler is a stub until its week in the timeline. */
const notYet = (req, res) => res.fail(501, 'Not implemented yet.');

/* GET /api/geofence/nearby  ?lat=&lng=&radius= (radius 1 to 5, inside Dagupan) */
exports.nearby = notYet;

/* GET /api/geofence/barangays  Barangay list and boundaries */
exports.barangays = notYet;

/* GET /api/geofence/barangay/:id/reports  Reports inside a zone */
exports.barangayReports = notYet;
