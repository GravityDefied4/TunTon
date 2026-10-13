/* =========================================================
   User store (MySQL). Same async interface the JSON version had,
   so auth code did not change. Column mapping to the schema:
     picture_url -> picture      (API name)
     given_name  -> derived from full_name (no column in schema.sql)
   Ids are INT AUTO_INCREMENT (schema.sql), e.g. 1, 2, 3.
   ========================================================= */
const pool = require('./pool');

const COLS = `user_id, google_sub, full_name, email, phone, picture_url AS picture, role, status, created_at, last_login_at`;

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

  async create({ google_sub, email, full_name, picture, role }) {
    const f = fit({ email, full_name, picture });
    /* A seeded account (no google_sub yet) with the same email is claimed instead of duplicated. */
    const existing = await findOne('email = ?', [f.email]);
    if (existing) {
      if (existing.google_sub && existing.google_sub !== google_sub) throw Object.assign(new Error('That email belongs to another account.'), { status: 409 });
      await pool.query('UPDATE users SET google_sub = ?, full_name = ?, picture_url = ?, role = ?, last_login_at = NOW() WHERE user_id = ?',
        [google_sub, f.full_name, f.picture, role, existing.user_id]);
      return module.exports.findById(existing.user_id);
    }
    const [r] = await pool.query(
      'INSERT INTO users (google_sub, full_name, email, picture_url, role, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [google_sub, f.full_name, f.email, f.picture, role]);
    return module.exports.findById(r.insertId);
  },

  /* Refresh profile fields from Google and stamp the login time. */
  async touchLogin(id, { email, full_name, picture, role }) {
    const f = fit({ email, full_name, picture });
    await pool.query('UPDATE users SET email = ?, full_name = ?, picture_url = ?, role = ?, last_login_at = NOW() WHERE user_id = ?',
      [f.email, f.full_name, f.picture, role, id]);
    return module.exports.findById(id);
  },

  /* PUT /api/users/me. Only the fields passed are changed. */
  async updateProfile(id, { full_name, phone }) {
    const sets = [], params = [];
    if (full_name !== undefined) { sets.push('full_name = ?'); params.push(full_name); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone); }
    if (sets.length) await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, [...params, id]);
    return module.exports.findById(id);
  }
};
