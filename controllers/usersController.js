const { publicUser } = require('./authController');

/* GET /api/users/me */
exports.getMe = (req, res) => res.ok({ user: { ...publicUser(req.user), phone: req.user.phone ?? null } });

/* PUT /api/users/me  { full_name?, phone?, barangay? }  TODO: validate, save via db layer, log in activity_logs */
exports.updateMe = (req, res) => res.fail(501, 'Not implemented yet.');
