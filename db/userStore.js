/* =========================================================
   User store (TEMPORARY: JSON file).
   Same async interface the MySQL version will have, so the
   database team can replace this file with mysql2 queries
   (see docs/AUTH.md for the users table) and nothing else changes.
   ========================================================= */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'users.json');
let queue = Promise.resolve(); // serialize writes

async function load() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

async function save(users) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(users, null, 2));
  await fs.rename(tmp, FILE);
}

const mutate = fn => (queue = queue.then(async () => {
  const users = await load();
  const result = await fn(users);
  await save(users);
  return result;
}));

module.exports = {
  async findById(id) {
    return (await load()).find(u => u.user_id === id) || null;
  },

  async findByGoogleSub(sub) {
    return (await load()).find(u => u.google_sub === sub) || null;
  },

  async create({ google_sub, email, full_name, given_name, picture, role }) {
    return mutate(users => {
      const now = new Date().toISOString();
      const user = {
        user_id: crypto.randomUUID(), google_sub, email, full_name, given_name, picture,
        phone: null, role, status: 'active', created_at: now, last_login_at: now
      };
      users.push(user);
      return user;
    });
  },

  /* Refresh profile fields from Google and stamp the login time. */
  async touchLogin(id, { email, full_name, given_name, picture, role }) {
    return mutate(users => {
      const user = users.find(u => u.user_id === id);
      if (!user) return null;
      Object.assign(user, { email, full_name, given_name, picture, role, last_login_at: new Date().toISOString() });
      return user;
    });
  }
};
