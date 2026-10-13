/* admin controller: business logic lives here, routes only map URLs (plan rule 2).
   Routes are behind requireAuth + requireRole('admin'). Phone numbers are never returned here:
   contact details are released only through an approved claim (plan rule 5). */
const pool = require('../db/pool');
const { withTransaction, logActivity } = require('../db/activityLog');
const rq = require('../db/reportQueries');
const { wrap } = require('../middleware/errorHandler');
const v = require('../middleware/validate');
const { runQuietly } = require('../services/matchRunner');

const like = s => '%' + String(s).trim().slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';

/* GET /api/admin/users  ?q=&role=&status=&limit=&offset=  (name, email, report counts; no phone) */
exports.users = wrap(async (req, res) => {
  const { limit, offset } = v.paging(req.query);
  const where = [], params = [];
  if (req.query.role) { where.push('u.role = ?'); params.push(v.oneOf(req.query.role, ['user', 'admin'], 'role')); }
  if (req.query.status) { where.push('u.status = ?'); params.push(v.oneOf(req.query.status, ['active', 'suspended'], 'status')); }
  if (req.query.q && String(req.query.q).trim()) { where.push('(u.full_name LIKE ? OR u.email LIKE ?)'); params.push(like(req.query.q), like(req.query.q)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT u.user_id AS id, u.full_name AS name, u.email, u.role, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM pet_reports r WHERE r.user_id = u.user_id) AS report_count,
            (SELECT COUNT(*) FROM claims c WHERE c.claimant_user_id = u.user_id) AS claim_count
       FROM users u ${whereSql} ORDER BY u.created_at DESC, u.user_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${whereSql}`, params);
  res.ok({ items: rows, total, limit, offset });
});

/* PATCH /api/admin/users/:id/status  { status: 'active' | 'suspended', reason? }  */
exports.setUserStatus = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'user id');
  const status = v.oneOf(req.body?.status, ['active', 'suspended'], 'status');
  const reason = v.text(req.body?.reason, 'reason', { max: 300 });
  if (id === req.user.user_id) throw v.bad('You cannot change the status of your own account.');

  const user = await withTransaction(async conn => {
    const [[u]] = await conn.query('SELECT user_id, role, status FROM users WHERE user_id = ? FOR UPDATE', [id]);
    if (!u) throw Object.assign(new Error('User not found.'), { status: 404 });
    if (u.role === 'admin') throw Object.assign(new Error('Admin accounts cannot be suspended here.'), { status: 403 });
    if (u.status !== status) {
      await conn.query('UPDATE users SET status = ? WHERE user_id = ?', [status, id]);
      await logActivity({ userId: req.user.user_id, action: status === 'suspended' ? 'user_suspended' : 'user_reactivated', table: 'users', id, details: { reason } }, conn);
    }
    return { id, status };
  });
  res.ok({ user }, status === 'suspended' ? 'User suspended.' : 'User reactivated.');
});

/* GET /api/admin/reports  ?type=&status=&species=&q=&barangay_id=&user_id=&limit=&offset=  (includes removed, with reporter name/email) */
exports.reports = wrap(async (req, res) => {
  const where = [], params = [];
  const q = req.query;
  if (q.type) { where.push('r.report_type = ?'); params.push(v.oneOf(q.type, ['lost', 'found'], 'type')); }
  if (q.status && q.status !== 'all') { where.push('r.status = ?'); params.push(v.oneOf(q.status, ['active', 'matched', 'resolved', 'closed', 'removed'], 'status')); }
  if (q.species) { if (/^\d+$/.test(q.species)) { where.push('r.species_id = ?'); params.push(Number(q.species)); } else { where.push('sp.name = ?'); params.push(String(q.species)); } }
  if (q.barangay_id) { where.push('r.barangay_id = ?'); params.push(v.id(q.barangay_id, 'barangay_id')); }
  if (q.user_id) { where.push('r.user_id = ?'); params.push(v.id(q.user_id, 'user_id')); }
  if (q.q && String(q.q).trim()) {
    where.push('(r.pet_name LIKE ? OR r.markings LIKE ? OR r.description LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(...Array(5).fill(like(q.q)));
  }
  const out = await rq.findReports({
    where, params, ...v.paging(q), includeRemoved: true, viewerId: req.user.user_id,
    orderBy: 'r.created_at DESC, r.report_id DESC',
    extraJoins: 'JOIN users u ON u.user_id = r.user_id',
    extraCols: 'u.full_name AS reporter_name, u.email AS reporter_email'
  });
  res.ok(out);
});

/* PATCH /api/admin/reports/:id/remove  { reason }  Remove an inappropriate report (kept in the database, hidden from users) */
exports.removeReport = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'report id');
  const reason = v.text(req.body?.reason, 'reason', { max: 300, required: true });
  await withTransaction(async conn => {
    const [[r]] = await conn.query('SELECT status FROM pet_reports WHERE report_id = ? FOR UPDATE', [id]);
    if (!r) throw Object.assign(new Error('Report not found.'), { status: 404 });
    if (r.status === 'removed') throw Object.assign(new Error('This report is already removed.'), { status: 409 });
    await conn.query("UPDATE pet_reports SET status = 'removed' WHERE report_id = ?", [id]);
    await logActivity({ userId: req.user.user_id, action: 'report_removed', table: 'pet_reports', id, details: { reason, previous_status: r.status } }, conn);
  });
  await runQuietly(id, req.user.user_id);   // drops its open suggestions
  res.ok({ id, status: 'removed' }, 'Report removed.');
});

/* GET /api/admin/claims  ?status=&limit=&offset=  Review claims and disputes (flagged = all proof submissions rejected) */
exports.claims = wrap(async (req, res) => {
  const { limit, offset } = v.paging(req.query);
  const where = [], params = [];
  if (req.query.status && req.query.status !== 'all') { where.push('c.status = ?'); params.push(v.oneOf(req.query.status, ['pending_proof', 'under_review', 'approved', 'rejected'], 'status')); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT c.claim_id AS id, c.status, c.created_at, c.decided_at, c.decision_reason,
            m.match_id, m.score, m.label, m.status AS match_status,
            m.lost_report_id, lr.pet_name AS lost_pet_name, m.found_report_id,
            c.claimant_user_id, cu.full_name AS claimant_name, fr.user_id AS finder_user_id, fu.full_name AS finder_name,
            c.decided_by, du.full_name AS decided_by_name,
            (SELECT COALESCE(MAX(p.attempt_no), 0) FROM claim_proofs p WHERE p.claim_id = c.claim_id) AS attempts_used,
            (SELECT COUNT(*) FROM claim_proofs p WHERE p.claim_id = c.claim_id) AS proof_count
       FROM claims c
       JOIN matches m ON m.match_id = c.match_id
       JOIN pet_reports lr ON lr.report_id = m.lost_report_id
       JOIN pet_reports fr ON fr.report_id = m.found_report_id
       JOIN users cu ON cu.user_id = c.claimant_user_id
       JOIN users fu ON fu.user_id = fr.user_id
       LEFT JOIN users du ON du.user_id = c.decided_by
       ${whereSql} ORDER BY c.created_at DESC, c.claim_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM claims c ${whereSql}`, params);
  res.ok({ items: rows.map(r => ({ ...r, flagged: r.status === 'rejected' && r.attempts_used >= 3 })), total, limit, offset });
});

/* GET /api/admin/stats  Dashboard numbers: totals, recovery rate, reports per barangay */
exports.stats = wrap(async (req, res) => {
  const count = async (sql) => Object.fromEntries((await pool.query(sql))[0].map(r => [r.k, Number(r.n)]));
  const [users, reportsByType, reportsByStatus, matches, claims] = await Promise.all([
    count('SELECT status AS k, COUNT(*) AS n FROM users GROUP BY status'),
    count("SELECT report_type AS k, COUNT(*) AS n FROM pet_reports WHERE status <> 'removed' GROUP BY report_type"),
    count('SELECT status AS k, COUNT(*) AS n FROM pet_reports GROUP BY status'),
    count('SELECT status AS k, COUNT(*) AS n FROM matches GROUP BY status'),
    count('SELECT status AS k, COUNT(*) AS n FROM claims GROUP BY status')
  ]);
  const [perBarangay] = await pool.query(
    `SELECT b.barangay_id AS id, b.name,
            COALESCE(SUM(r.report_type = 'lost'), 0) AS lost, COALESCE(SUM(r.report_type = 'found'), 0) AS found, COUNT(r.report_id) AS total
       FROM barangays b LEFT JOIN pet_reports r ON r.barangay_id = b.barangay_id AND r.status <> 'removed'
      GROUP BY b.barangay_id, b.name ORDER BY total DESC, b.name`);
  const [[recent]] = await pool.query("SELECT COUNT(*) AS n FROM pet_reports WHERE status <> 'removed' AND created_at >= NOW() - INTERVAL 7 DAY");

  /* Recovery rate = lost reports that ended matched or resolved / all lost reports (removed ones excluded). */
  const [[lost]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(status IN ('matched', 'resolved')), 0) AS recovered
       FROM pet_reports WHERE report_type = 'lost' AND status <> 'removed'`);
  res.ok({
    users: { total: Object.values(users).reduce((a, b) => a + b, 0), active: users.active || 0, suspended: users.suspended || 0 },
    reports: { lost: reportsByType.lost || 0, found: reportsByType.found || 0, by_status: reportsByStatus, new_last_7_days: Number(recent.n) },
    matches, claims,
    recovery: { lost_total: Number(lost.total), recovered: Number(lost.recovered), rate: lost.total ? Math.round(1000 * lost.recovered / lost.total) / 10 : 0 },   // percent
    per_barangay: perBarangay.map(b => ({ ...b, lost: Number(b.lost), found: Number(b.found), total: Number(b.total) }))
  });
});

/* GET /api/admin/logs  ?user_id=&action=&target_table=&target_id=&limit=&offset=  Audit trail, newest first */
exports.logs = wrap(async (req, res) => {
  const { limit, offset } = v.paging(req.query, 50);
  const where = [], params = [], q = req.query;
  if (q.user_id) { where.push('l.user_id = ?'); params.push(v.id(q.user_id, 'user_id')); }
  if (q.action) { where.push('l.action = ?'); params.push(String(q.action).slice(0, 60)); }
  if (q.target_table) { where.push('l.target_table = ?'); params.push(String(q.target_table).slice(0, 40)); }
  if (q.target_id) { where.push('l.target_id = ?'); params.push(v.id(q.target_id, 'target_id')); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT l.log_id AS id, l.user_id, u.full_name AS user_name, l.action, l.target_table, l.target_id, l.details, l.created_at
       FROM activity_logs l LEFT JOIN users u ON u.user_id = l.user_id ${whereSql} ORDER BY l.log_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM activity_logs l ${whereSql}`, params);
  res.ok({ items: rows, total, limit, offset });
});
