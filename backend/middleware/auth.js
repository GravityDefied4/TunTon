const jwt = require('jsonwebtoken');
const users = require('../db/userStore');
const { requireRole } = require('./role');

/* Requires "Authorization: Bearer <jwt>". Sets req.user from the database,
   so suspended users are cut off even if their token is still valid. */
async function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return res.fail(401, 'Please log in.');
  try {
    const { sub } = jwt.verify(m[1], process.env.JWT_SECRET);
    const user = await users.findById(sub);
    if (!user) return res.fail(401, 'Account not found.');
    if (user.status !== 'active') return res.fail(403, 'This account is suspended.');
    req.user = user;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return res.fail(401, 'Session expired. Please log in again.');
    next(e);
  }
}

module.exports = { requireAuth, requireRole };   // requireRole re-exported: docs/AUTH.md imports both from here
