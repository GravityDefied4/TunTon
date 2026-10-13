/* Use after requireAuth:  router.use(requireAuth, requireRole('admin')) */
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.fail(403, 'You do not have access to this.');

module.exports = { requireRole };
