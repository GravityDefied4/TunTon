const { publicUser } = require('./authController');
const users = require('../db/userStore');
const { logActivity } = require('../db/activityLog');
const { wrap } = require('../middleware/errorHandler');
const v = require('../middleware/validate');

const PHONE = /^(\+63|09)[0-9]{9}$/;   // same rule as chk_users_phone in schema.sql

const me = u => ({ ...publicUser(u), phone: u.phone ?? null });

/* GET /api/users/me */
exports.getMe = (req, res) => res.ok({ user: me(req.user) });

/* PUT /api/users/me  { full_name?, phone? }  Only the fields sent are changed. phone "" or null clears it.
   (The users table has no barangay column, so a barangay field is ignored.) */
exports.updateMe = wrap(async (req, res) => {
  const body = req.body || {};
  const changes = {};
  if ('full_name' in body) changes.full_name = v.text(body.full_name, 'full_name', { max: 100, required: true });
  if ('phone' in body) {
    const p = v.text(body.phone, 'phone', { max: 15 });
    if (p !== null && !PHONE.test(p)) throw v.bad('Phone must look like 09171234567 or +639171234567.');
    changes.phone = p;
  }
  if (!Object.keys(changes).length) throw v.bad('Nothing to update. Send full_name and/or phone.');

  const user = await users.updateProfile(req.user.user_id, changes);
  await logActivity({ userId: req.user.user_id, action: 'profile_updated', table: 'users', id: req.user.user_id, details: { fields: Object.keys(changes) } });
  res.ok({ user: me(user) }, 'Profile updated.');
});
