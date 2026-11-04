/* =========================================================
   User store (MySQL). Same async interface the JSON version had,
   so auth code did not change. Column mapping to the schema:
     picture_url -> picture      (API name)
     given_name  -> derived from full_name (no column in schema.sql)
   Ids are INT AUTO_INCREMENT (schema.sql), e.g. 1, 2, 3.
   ========================================================= */
const pool = require('./pool');

/* picture_url holds either a Google URL (starts with http) or just the file name of a picture the person uploaded
   (e.g. 3f2a....jpg, kept in backend/uploads/avatars/). A Google login refreshes the Google picture but must not replace an uploaded one. */

const COLS = `user_id, google_sub, full_name, email, phone, facebook_profile_link, messenger_profile_link, barangay_id,
  (SELECT b.name FROM barangays b WHERE b.barangay_id = users.barangay_id) AS barangay,
  picture_url AS picture, role, status, created_at, last_login_at`;

const withGivenName = u => u && { ...u, given_name: (u.full_name || u.email).split(' ')[0] };

const badRequest = message => Object.assign(new Error(message), { status: 400 });

/* schema.sql limits: email 50, full_name 100, picture_url 255. Strict mode would
   otherwise turn an over-long Google value into a 500. */
function fit({ email, full_name, picture }) {
  if (email.length > 50) throw badRequest('Your Google email is too long for TunTon (max 50 characters).');
  return {
    email,
    full_name: (full_name || email).slice(0, 100),
    picture: picture && picture.length <= 255 ? picture : null
  };
}

async function findOne(where, params) {
  const [rows] = await pool.query(`SELECT ${COLS} FROM users WHERE ${where} LIMIT 1`, params);
  return withGivenName(rows[0]) || null;
}

module.exports = {
  findById: id => findOne('user_id = ?', [id]),
  findByEmail: email => findOne('email = ?', [email]),
  findByGoogleSub: sub => findOne('google_sub = ?', [sub]),

  /* Login only: the one place password_hash is read. It is never part of COLS, so it cannot leak into API output. */
  async findCredentials(email) {
    const [rows] = await pool.query('SELECT user_id, password_hash, status FROM users WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
  },

  /* Email + password sign-up. Role is always 'user' (admins are set in MySQL only). */
  async createWithPassword({ email, full_name, password_hash }) {
    const f = fit({ email, full_name, picture: null });
    const [r] = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role, last_login_at) VALUES (?, ?, ?, \'user\', NOW())',
      [f.full_name, f.email, password_hash]);
    return module.exports.findById(r.insertId);
  },

  /* Uploaded profile picture (file name only) or null to remove it. */
  async setPicture(id, url) {
    await pool.query('UPDATE users SET picture_url = ? WHERE user_id = ?', [url, id]);
    return module.exports.findById(id);
  },

  async markLogin(id) {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE user_id = ?', [id]);
    return module.exports.findById(id);
  },

  /* Role is never written here: new rows take the column default ('user'), existing rows keep whatever the database says. */
  async create({ google_sub, email, full_name, picture }) {
    const f = fit({ email, full_name, picture });
    /* A seeded account (no google_sub yet) with the same email is claimed instead of duplicated. */
    const existing = await findOne('email = ?', [f.email]);
    if (existing) {
      if (existing.google_sub && existing.google_sub !== google_sub) throw Object.assign(new Error('That email belongs to another account.'), { status: 409 });
      /* Google has verified this email, a password sign-up has not. Drop any password on the row so someone who
         registered a victim's email first cannot keep a way in after the real owner signs in with Google. */
      await pool.query(`UPDATE users SET google_sub = ?, full_name = ?, picture_url = IF(picture_url IS NOT NULL AND picture_url NOT LIKE 'http%', picture_url, ?), password_hash = NULL, last_login_at = NOW() WHERE user_id = ?`,
        [google_sub, f.full_name, f.picture, existing.user_id]);
      return module.exports.findById(existing.user_id);
    }
    const [r] = await pool.query(
      'INSERT INTO users (google_sub, full_name, email, picture_url, last_login_at) VALUES (?, ?, ?, ?, NOW())',
      [google_sub, f.full_name, f.email, f.picture]);
    return module.exports.findById(r.insertId);
  },

  /* Refresh profile fields from Google and stamp the login time. */
  async touchLogin(id, { email, full_name, picture }) {
    const f = fit({ email, full_name, picture });
    await pool.query(`UPDATE users SET email = ?, full_name = ?, picture_url = IF(picture_url IS NOT NULL AND picture_url NOT LIKE 'http%', picture_url, ?), last_login_at = NOW() WHERE user_id = ?`,
      [f.email, f.full_name, f.picture, id]);
    return module.exports.findById(id);
  },

  /* Barangay id for a barangay name (the profile form sends the name). null when there is no such barangay. */
  async barangayIdByName(name) {
    const [rows] = await pool.query('SELECT barangay_id FROM barangays WHERE name = ? LIMIT 1', [name]);
    return rows[0]?.barangay_id ?? null;
  },

  /* PUT /api/users/me. Only the fields passed are changed. */
  async updateProfile(id, { full_name, phone, facebook_profile_link, messenger_profile_link, barangay_id }) {
    const sets = [], params = [];
    if (full_name !== undefined) { sets.push('full_name = ?'); params.push(full_name); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone); }
    if (facebook_profile_link !== undefined) { sets.push('facebook_profile_link = ?'); params.push(facebook_profile_link); }
    if (messenger_profile_link !== undefined) { sets.push('messenger_profile_link = ?'); params.push(messenger_profile_link); }
    if (barangay_id !== undefined) { sets.push('barangay_id = ?'); params.push(barangay_id); }
    if (sets.length) await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, [...params, id]);
    return module.exports.findById(id);
  }
};
