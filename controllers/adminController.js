/* admin controller: business logic lives here, routes only map URLs (plan rule 2).
   Every handler is a stub until its week in the timeline. */
const notYet = (req, res) => res.fail(501, 'Not implemented yet.');

/* GET /api/admin/users  List users */
exports.users = notYet;

/* PATCH /api/admin/users/:id/status  Suspend or reactivate */
exports.setUserStatus = notYet;

/* GET /api/admin/reports  All reports with filters */
exports.reports = notYet;

/* PATCH /api/admin/reports/:id/remove  Remove inappropriate report */
exports.removeReport = notYet;

/* GET /api/admin/claims  Review claims and disputes */
exports.claims = notYet;

/* GET /api/admin/stats  Dashboard numbers */
exports.stats = notYet;

/* GET /api/admin/logs  Audit trail */
exports.logs = notYet;
