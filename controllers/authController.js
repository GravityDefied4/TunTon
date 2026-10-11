const jwt = require('jsonwebtoken');
const users = require('../db/userStore');
const { verifyGoogleCredential } = require('../services/google');

const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const roleFor = email => (adminEmails().includes(email) ? 'admin' : 'user');

const publicUser = u => ({ id: u.user_id, name: u.full_name, given_name: u.given_name, email: u.email,
  picture: u.picture, role: u.role });

const signToken = u => jwt.sign({ role: u.role }, process.env.JWT_SECRET,
  { subject: u.user_id, expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

/* Public config the browser needs (client IDs are not secrets). */
exports.config = (req, res) => res.ok({ googleClientId: process.env.GOOGLE_CLIENT_ID });

/* POST /api/auth/google  { credential, mode: 'login' | 'signup' }
   Verifies the Google ID token, then returns TunTon's own JWT. */
exports.google = async (req, res, next) => {
  const { credential, mode } = req.body || {};
  if (typeof credential !== 'string' || !credential) return res.fail(400, 'Missing Google credential.');
  if (mode !== 'login' && mode !== 'signup') return res.fail(400, 'Invalid mode.');

  let profile;
  try { profile = await verifyGoogleCredential(credential); }
  catch { return res.fail(401, 'Google sign-in could not be verified. Please try again.'); }

  try {
    let user = await users.findByGoogleSub(profile.google_sub);
    const role = roleFor(profile.email);

    if (!user && mode === 'login') {
      return res.fail(404, 'No TunTon account found for this Google account. Sign up to continue.', { code: 'NO_ACCOUNT' });
    }
    if (!user) user = await users.create({ ...profile, role });
    else {
      if (user.status !== 'active') return res.fail(403, 'This account is suspended.');
      user = await users.touchLogin(user.user_id, { ...profile, role });
    }
    res.ok({ token: signToken(user), user: publicUser(user) }, 'Signed in.');
  } catch (e) { next(e); }
};

/* GET /api/auth/me: who am I (also used to validate a stored token) */
exports.me = (req, res) => res.ok({ user: publicUser(req.user) });

/* POST /api/auth/logout: JWTs are stateless, so the browser just discards it. */
exports.logout = (req, res) => res.ok(null, 'Logged out.');

exports.publicUser = publicUser;
