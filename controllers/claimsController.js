/* claims controller: business logic lives here, routes only map URLs (plan rule 2).
   Every handler is a stub until its week in the timeline. */
const notYet = (req, res) => res.fail(501, 'Not implemented yet.');

/* POST /api/claims/  Start a claim on a match (owner of lost report) */
exports.create = notYet;

/* POST /api/claims/:id/proofs  Upload proof files, max 3 submissions (claimant) */
exports.addProofs = notYet;

/* GET /api/claims/:id  View claim status (involved users) */
exports.getOne = notYet;

/* PATCH /api/claims/:id/decision  Approve or reject (finder or admin) */
exports.decide = notYet;

/* GET /api/claims/:id/contact  Released contact info, ONLY if approved */
exports.contact = notYet;
