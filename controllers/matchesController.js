/* matches controller: business logic lives here, routes only map URLs (plan rule 2).
   Every handler is a stub until its week in the timeline. */
const notYet = (req, res) => res.fail(501, 'Not implemented yet.');

/* POST   P4: recompute matches for a report (system or owner) */
exports.run = notYet;

/* GET   Matches for my reports */
exports.mine = notYet;

/* GET   Match details side by side (involved users) */
exports.getOne = notYet;

/* PATCH   Dismiss a suggestion (involved users) */
exports.dismiss = notYet;
