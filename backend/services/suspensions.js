/* Suspensions: how long they last, hiding/restoring the user's reports, and lifting them when the time is up.

   An admin suspends for 3 days, 7 days, 30 days or permanently. A timed suspension stores its end in
   users.suspended_until (NULL = permanent). It is lifted automatically by:
     1. liftExpired() on a timer (startSweeper, started from server.js), and
     2. liftExpired(userId) the moment that user tries to log in or use their token (userStore), so nobody waits for the timer.
   Lifting does exactly what an admin pressing "Reactivate" does: the account is active again and the reports that were
   hidden BY the suspension come back. Reports an admin hid on their own stay hidden. */
const pool = require('../db/pool');
const { withTransaction, logActivity } = require('../db/activityLog');

/* Log action for a report hidden because its owner was suspended (kept apart from 'report_removed', an admin hiding it). */
const HOLD_ACTION = 'report_hidden_owner_suspended';

/* Option sent by the admin page -> { days, label }. days null = permanent. */
const DURATIONS = {
  '3d':      { days: 3,    label: '3 days' },
  '7d':      { days: 7,    label: '7 days' },
  '30d':     { days: 30,   label: '30 days' },
  permanent: { days: null, label: 'Permanent' }
};

/* Hide every visible report of this user until they are reactivated. Reports the admin already hid are skipped, so
   they are never touched here and stay hidden after reactivation. The report's old status is logged. */
async function hideReports(conn, userId, actorId) {
  const [mine] = await conn.query("SELECT report_id, status FROM pet_reports WHERE user_id = ? AND status <> 'removed' FOR UPDATE", [userId]);
  for (const r of mine) {
    await conn.query("UPDATE pet_reports SET status = 'removed' WHERE report_id = ?", [r.report_id]);
    await logActivity({ userId: actorId, action: HOLD_ACTION, table: 'pet_reports', id: r.report_id, details: { previous_status: r.status, owner_suspended: userId } }, conn);
  }
}

/* Bring back only the reports hidden BY the suspension: a report is one of those when its latest hide entry is the
   suspension one. A report the admin hid on its own (a 'report_removed' entry) stays hidden.
   Returns the ids that are active again (the caller refreshes their matches). */
async function restoreReports(conn, userId, actorId) {
  const restored = [];
  const [hidden] = await conn.query("SELECT report_id FROM pet_reports WHERE user_id = ? AND status = 'removed' FOR UPDATE", [userId]);
  for (const r of hidden) {
    const [[last]] = await conn.query(
      `SELECT action, JSON_UNQUOTE(JSON_EXTRACT(details, '$.previous_status')) AS previous_status FROM activity_logs
        WHERE target_table = 'pet_reports' AND target_id = ? AND action IN ('report_removed', ?) ORDER BY log_id DESC LIMIT 1`, [r.report_id, HOLD_ACTION]);
    if (last?.action !== HOLD_ACTION) continue;
    const back = ['active', 'matched', 'resolved', 'closed'].includes(last.previous_status) ? last.previous_status : 'active';
    await conn.query('UPDATE pet_reports SET status = ? WHERE report_id = ?', [back, r.report_id]);
    await logActivity({ userId: actorId, action: 'report_restored', table: 'pet_reports', id: r.report_id, details: { restored_status: back, owner_reactivated: userId } }, conn);
    if (back === 'active') restored.push(r.report_id);
  }
  return restored;
}

/* Lift every suspension whose time is up (or only userId's). Returns how many accounts were reactivated. */
async function liftExpired(userId = null) {
  const [due] = await pool.query(
    `SELECT user_id FROM users WHERE status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until <= NOW()${userId ? ' AND user_id = ?' : ''}`,
    userId ? [userId] : []);
  let lifted = 0;
  for (const { user_id } of due) {
    const restored = await withTransaction(async conn => {
      const [[u]] = await conn.query(
        "SELECT user_id FROM users WHERE user_id = ? AND status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until <= NOW() FOR UPDATE", [user_id]);
      if (!u) return null;   // an admin changed it in the meantime
      await conn.query("UPDATE users SET status = 'active', suspension_reason = NULL, suspended_at = NULL, suspended_until = NULL WHERE user_id = ?", [user_id]);
      await logActivity({ userId: null, action: 'user_reactivated', table: 'users', id: user_id, details: { auto: true, reason: 'Suspension time ended' } }, conn);
      return restoreReports(conn, user_id, null);
    });
    if (!restored) continue;
    lifted++;
    const { runQuietly } = require('./matchRunner');   // loaded here to avoid a circular require at start-up
    for (const rid of restored) await runQuietly(rid, null);
  }
  return lifted;
}

/* Called once from server.js: lifts finished suspensions every minute. */
function startSweeper(everyMs = 60 * 1000) {
  const tick = () => liftExpired().catch(e => console.error('[suspensions] sweep failed:', e.message));
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return timer;
}

module.exports = { DURATIONS, HOLD_ACTION, hideReports, restoreReports, liftExpired, startSweeper };