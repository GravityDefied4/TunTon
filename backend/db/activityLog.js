/* Audit trail helper (plan 5.3: "Log every step in activity_logs").
   Pass a transaction connection as `db` so the log row commits or rolls back with the change;
   omit it to use the pool. */
const pool = require('./pool');

async function logActivity({ userId = null, action, table, id, details = null }, db = pool) {
  await db.query(
    'INSERT INTO activity_logs (user_id, action, target_table, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId, action, table, id, details ? JSON.stringify(details) : null]
  );
}

/* Run fn(conn) inside a transaction; commits on success, rolls back on any throw. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { logActivity, withTransaction };
