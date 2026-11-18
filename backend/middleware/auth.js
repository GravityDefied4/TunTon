const jwt = require('jsonwebtoken');
const users = require('../db/userStore');
const { requireRole } = require('./role');

/* 403 for a suspended account. `code` + `reason` let the website show the reason in a popup (the reason is only ever sent
   to the person it is about: this is returned after the password / Google check, or for their own valid token). */
const accountSuspended = (res, u) => res.fail(403, 'This account is suspended.', {
  code: 'ACCOUNT_SUSPENDED', reason: u.suspension_reason || null,
  until: u.suspended_until_ms ? new Date(Number(u.suspended_until_ms)).toISOString() : null   // null = permanent; otherwise when it is lifted
});

/* Requires "Authorization: Bearer <jwt>". Sets req.user from the database,
   so suspended users are cut off even if their token is still valid. */
async function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return res.fail(401, 'Please log in.');
  try {
    const { sub } = jwt.verify(m[1], process.env.JWT_SECRET);
    const user = await users.findById(sub);
    if (!user) return res.fail(401, 'Account not found.');
    if (user.status !== 'active') return accountSuspended(res, user);
    req.user = user;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return res.fail(401, 'Session expired. Please log in again.');
    next(e);
  }
}

module.exports = { requireAuth, requireRole, accountSuspended };   // requireRole re-exported: docs/AUTH.md imports both from here