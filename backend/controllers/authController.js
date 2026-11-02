const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const users = require('../db/userStore');
const { verifyGoogleCredential } = require('../services/google');

const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const roleFor = email => (adminEmails().includes(email) ? 'admin' : 'user');

/* The database keeps only the file name of an uploaded picture. The browser gets the full path; Google URLs pass through. */
const pictureUrl = p => (p && !/^(https?:)?\//.test(p) ? '/uploads/avatars/' + p : p || null);

const publicUser = u => ({ id: u.user_id, name: u.full_name, given_name: u.given_name, email: u.email,
  picture: pictureUrl(u.picture), role: u.role });

const signToken = u => jwt.sign({ role: u.role }, process.env.JWT_SECRET,
  { subject: String(u.user_id), expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BCRYPT_COST = 12;
/* Compared against when the email is unknown, so "no such account" takes as long as "wrong password". */
const DUMMY_HASH = bcrypt.hashSync('tunton-timing-equalizer', BCRYPT_COST);

/* Body fields must be real strings: an object here would be expanded by mysql2 into SQL (`email = `a` = 1`). */
const str = (v, label) => {
  if (typeof v !== 'string') throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  return v;
};

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

/* POST /api/auth/register  { name, email, password }  -> { token, user } */
exports.register = async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = str(body.name, 'Name').trim();
    const email = str(body.email, 'Email').trim().toLowerCase();
    const password = str(body.password, 'Password');

    if (name.length < 2 || name.length > 100) return res.fail(400, 'Please enter your full name (2 to 100 characters).');
    if (!EMAIL_RE.test(email)) return res.fail(400, 'That email address does not look right.');
    if (email.length > 50) return res.fail(400, 'Your email is too long for TunTon (max 50 characters).');
    if (password.length < 8) return res.fail(400, 'Your password needs at least 8 characters.');
    if (Buffer.byteLength(password) > 72) return res.fail(400, 'Your password is too long (max 72 characters).');   // bcrypt ignores everything past 72 bytes

    if (await users.findByEmail(email)) return res.fail(409, 'An account with this email already exists. Try logging in.');

    const user = await users.createWithPassword({ email, full_name: name, password_hash: await bcrypt.hash(password, BCRYPT_COST) });
    res.status(201).ok({ token: signToken(user), user: publicUser(user) }, 'Account created.');
  } catch (e) { next(e); }   // a duplicate-email race hits the UNIQUE key and becomes a 409 in errorHandler
};

/* POST /api/auth/login  { email, password }  -> { token, user }
   Wrong email, wrong password and Google-only accounts all get the same message. */
exports.login = async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = str(body.email, 'Email').trim().toLowerCase();
    const password = str(body.password, 'Password');
    if (!password || Buffer.byteLength(password) > 72) return res.fail(401, 'Incorrect email or password.');

    const cred = await users.findCredentials(email);
    const ok = await bcrypt.compare(password, cred?.password_hash || DUMMY_HASH);
    if (!cred || !cred.password_hash || !ok) return res.fail(401, 'Incorrect email or password.');
    if (cred.status !== 'active') return res.fail(403, 'This account is suspended.');

    const user = await users.markLogin(cred.user_id);
    res.ok({ token: signToken(user), user: publicUser(user) }, 'Signed in.');
  } catch (e) { next(e); }
};

/* GET /api/auth/me: who am I (also used to validate a stored token) */
exports.me = (req, res) => res.ok({ user: publicUser(req.user) });

/* POST /api/auth/logout: JWTs are stateless, so the browser just discards it. */
exports.logout = (req, res) => res.ok(null, 'Logged out.');

exports.publicUser = publicUser;
