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

/* claims no longer has a decision_reason column: the reason an owner gave when approving or rejecting a claim
   is kept in the audit trail (activity_logs.details.reason). Use this as a column in a SELECT over `claims c`. */
const CLAIM_REASON_SQL = `(SELECT JSON_UNQUOTE(JSON_EXTRACT(l.details, '$.reason')) FROM activity_logs l
    WHERE l.target_table = 'claims' AND l.target_id = c.claim_id AND l.action IN ('claim_approved', 'claim_rejected')
    ORDER BY l.log_id DESC LIMIT 1) AS decision_reason`;

module.exports = { logActivity, withTransaction, CLAIM_REASON_SQL };