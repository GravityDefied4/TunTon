const { publicUser } = require('./authController');
const users = require('../db/userStore');
const { logActivity } = require('../db/activityLog');
const { wrap } = require('../middleware/errorHandler');
const v = require('../middleware/validate');
const fs = require('fs/promises');
const path = require('path');
const { checkFiles, discardFiles, UPLOAD_ROOT } = require('../middleware/upload');

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
    if (body.phone !== null && body.phone !== undefined && typeof body.phone !== 'string') throw v.bad('Phone must be text.');
    let p = v.text(typeof body.phone === 'string' ? body.phone.replace(/[\s-]/g, '') : body.phone, 'phone', { max: 15 });   // "0917 123-4567" -> "09171234567"
    if (p !== null) p = p.replace(/^\+?63(?=9\d{9}$)/, '0');   // +63 9XX XXX XXXX is the same number as 09XX XXX XXXX; one stored form (chk_users_phone)
    if (p !== null && !PHONE.test(p)) throw v.bad('Phone must look like 09171234567 or +63 917 123 4567.');
    changes.phone = p;
  }
  if (!Object.keys(changes).length) throw v.bad('Nothing to update. Send full_name and/or phone.');

  const user = await users.updateProfile(req.user.user_id, changes);
  await logActivity({ userId: req.user.user_id, action: 'profile_updated', table: 'users', id: req.user.user_id, details: { fields: Object.keys(changes) } });
  res.ok({ user: me(user) }, 'Profile updated.');
});

/* Delete the previous uploaded avatar (never a Google URL). basename() keeps it inside the avatars folder. */
const dropOldAvatar = stored => (stored && !/^https?:/.test(stored))
  ? fs.unlink(path.join(UPLOAD_ROOT, 'avatars', path.basename(stored))).catch(() => {}) : Promise.resolve();

/* POST /api/users/me/picture  (multipart, field "picture": JPG, PNG or WebP, max 5 MB) */
exports.setPicture = wrap(async (req, res) => {
  if (!req.file) throw v.bad('Choose an image to upload.');
  if (!(await checkFiles([req.file]))) { await discardFiles([req.file]); throw v.bad('That file is not a real JPG, PNG or WebP image.'); }
  const old = req.user.picture;
  let user;
  try { user = await users.setPicture(req.user.user_id, req.file.filename); }
  catch (e) { await discardFiles([req.file]); throw e; }
  await logActivity({ userId: req.user.user_id, action: 'profile_updated', table: 'users', id: req.user.user_id, details: { fields: ['picture'] } });
  await dropOldAvatar(old);
  res.ok({ user: me(user) }, 'Profile picture updated.');
});

/* DELETE /api/users/me/picture */
exports.removePicture = wrap(async (req, res) => {
  const old = req.user.picture;
  const user = await users.setPicture(req.user.user_id, null);
  await logActivity({ userId: req.user.user_id, action: 'profile_updated', table: 'users', id: req.user.user_id, details: { fields: ['picture'] } });
  await dropOldAvatar(old);
  res.ok({ user: me(user) }, 'Profile picture removed.');
});
