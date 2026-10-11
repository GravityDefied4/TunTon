/* reports controller: business logic lives here, routes only map URLs (plan rule 2).
   Every handler is a stub until its week in the timeline. */
const notYet = (req, res) => res.fail(501, 'Not implemented yet.');

/* POST /api/reports/  Create report (multipart with photos) */
exports.create = notYet;

/* GET /api/reports/  List with filters (type, species, status, radius) */
exports.list = notYet;

/* GET /api/reports/mine  Own reports (must stay above /:id) */
exports.mine = notYet;

/* GET /api/reports/:id  Details (contact info hidden) */
exports.getOne = notYet;

/* PUT /api/reports/:id  Update own report (owner only) */
exports.update = notYet;

/* PATCH /api/reports/:id/status  Close or resolve (owner only) */
exports.setStatus = notYet;
