/* admin controller: business logic lives here, routes only map URLs (plan rule 2).
   Routes are behind requireAuth + requireRole('admin'). Phone numbers are never returned here:
   phone numbers are never returned here (plan rule 5). Claims are listed only when they exist in the claims table. */
const pool = require('../db/pool');
const { withTransaction, logActivity, CLAIM_REASON_SQL } = require('../db/activityLog');
const rq = require('../db/reportQueries');
const { wrap } = require('../middleware/errorHandler');
const v = require('../middleware/validate');
const { runQuietly } = require('../services/matchRunner');

const like = s => '%' + String(s).trim().slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';

/* Photos of one report for the moderation view. report_photos is the only photo table in schema.sql;
   the image bytes live in image_data (older rows may have only a file_path). */
async function reportPhotos(reportId) {
  const [rows] = await pool.query(
    'SELECT photo_id, file_path, image_data, mime_type FROM report_photos WHERE report_id = ? ORDER BY is_primary DESC, photo_id', [reportId]);
  return rows.map(row => {
    const mimeType = row.mime_type ? String(row.mime_type) : 'image/jpeg';
    const src = row.image_data
      ? `data:${mimeType};base64,${Buffer.from(row.image_data).toString('base64')}`
      : (row.file_path ? `/uploads/reports/${encodeURIComponent(row.file_path)}` : '');
    return src ? { id: row.photo_id, src, mime_type: mimeType } : null;
  }).filter(Boolean);
}

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
  else if (q.hidden === 'true') where.push("r.status = 'removed'");
  else if (q.hidden === 'false') where.push("r.status <> 'removed'");
  if (q.species) { where.push('r.species = ?'); params.push(String(q.species).slice(0, 50)); }   // species is a text column on pet_reports
  if (q.barangay_id) { where.push('r.barangay_id = ?'); params.push(v.id(q.barangay_id, 'barangay_id')); }
  if (q.report_id) { where.push('r.report_id = ?'); params.push(v.id(q.report_id, 'report_id')); }
  if (q.user_id) { where.push('r.user_id = ?'); params.push(v.id(q.user_id, 'user_id')); }
  if (q.q && String(q.q).trim()) {
    where.push('(r.pet_name LIKE ? OR r.markings LIKE ? OR r.description LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(...Array(5).fill(like(q.q)));
  }
  const out = await rq.findReports({
    where, params, ...v.paging(q), includeRemoved: true, viewerId: req.user.user_id,
    orderBy: 'r.created_at DESC, r.report_id DESC',
    extraJoins: 'JOIN users u ON u.user_id = r.user_id',
    extraCols: `u.full_name AS reporter_name, u.email AS reporter_email,
      (SELECT COUNT(*) FROM claims c WHERE c.report_id = r.report_id) AS claims_count,
      (SELECT l.action FROM activity_logs l
        WHERE l.target_table = 'pet_reports' AND l.target_id = r.report_id
          AND l.action IN ('report_flagged_fraud', 'report_flagged_ai_generated')
        ORDER BY l.log_id DESC LIMIT 1) AS review_flag`
  });
  res.ok(out);
});

/* GET /api/admin/reports/:id — complete, read-only report view for moderation. */
exports.reportDetail = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'report id');
  const out = await rq.findReports({
    where: ['r.report_id = ?'], params: [id], limit: 1, offset: 0,
    includeRemoved: true, viewerId: req.user.user_id,
    extraJoins: 'JOIN users u ON u.user_id = r.user_id',
    extraCols: `u.full_name AS reporter_name, u.email AS reporter_email,
      (SELECT l.action FROM activity_logs l
        WHERE l.target_table = 'pet_reports' AND l.target_id = r.report_id
          AND l.action IN ('report_flagged_fraud', 'report_flagged_ai_generated')
        ORDER BY l.log_id DESC LIMIT 1) AS review_flag`
  });
  const candidates = out.items || out.rows || out.reports || out.data?.items || out.data?.rows || [];
  const resultRows = Array.isArray(candidates) ? candidates : [];
  const report = resultRows.find(row => Number(row.report_id ?? row.id) === Number(id));
  if (!report) throw Object.assign(new Error('Report not found.'), { status: 404 });
  report.photos = await reportPhotos(id);
  res.ok({ report });
});

/* PATCH /api/admin/reports/:id/flag — append an auditable moderation flag; never edits the report. */
exports.flagReport = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'report id');
  const type = v.oneOf(req.body?.type, ['fraud', 'ai_generated'], 'flag type');
  const reason = v.text(req.body?.reason, 'reason', { max: 500, required: true });
  const [[report]] = await pool.query('SELECT report_id FROM pet_reports WHERE report_id = ?', [id]);
  if (!report) throw Object.assign(new Error('Report not found.'), { status: 404 });
  const action = type === 'fraud' ? 'report_flagged_fraud' : 'report_flagged_ai_generated';
  await logActivity({ userId: req.user.user_id, action, table: 'pet_reports', id, details: { reason } });
  res.ok({ id, review_flag: action }, 'Report flag recorded.');
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

/* PATCH /api/admin/reports/:id/restore: restore the status saved when the report was hidden. */
exports.restoreReport = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'report id');
  let restoredStatus = 'active';
  await withTransaction(async conn => {
    const [[r]] = await conn.query('SELECT status FROM pet_reports WHERE report_id = ? FOR UPDATE', [id]);
    if (!r) throw Object.assign(new Error('Report not found.'), { status: 404 });
    if (r.status !== 'removed') throw Object.assign(new Error('This report is not hidden.'), { status: 409 });
    const [[log]] = await conn.query(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(details, '$.previous_status')) AS previous_status
         FROM activity_logs
        WHERE target_table = 'pet_reports' AND target_id = ? AND action = 'report_removed'
        ORDER BY log_id DESC LIMIT 1`, [id]);
    const allowed = ['active', 'matched', 'resolved', 'closed'];
    restoredStatus = allowed.includes(log?.previous_status) ? log.previous_status : 'active';
    await conn.query('UPDATE pet_reports SET status = ? WHERE report_id = ?', [restoredStatus, id]);
    await logActivity({ userId: req.user.user_id, action: 'report_restored', table: 'pet_reports', id, details: { restored_status: restoredStatus } }, conn);
  });
  if (restoredStatus === 'active') await runQuietly(id, req.user.user_id);
  res.ok({ id, status: restoredStatus }, 'Report restored.');
});

/* GET /api/admin/reports/:id/claims  Every claim on one report (including rejected ones, which are hidden from users).
   Only real rows from the claims table are returned, so a report nobody has claimed gives an empty list.
   Item: claimant name/email, claim type, status, message (the claimant's description). No phone numbers. */
exports.reportClaims = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'report id');
  const [[report]] = await pool.query('SELECT report_id FROM pet_reports WHERE report_id = ?', [id]);
  if (!report) throw Object.assign(new Error('Report not found.'), { status: 404 });
  const [rows] = await pool.query(
    `SELECT c.claim_id AS id, c.claim_type AS type, c.status, c.created_at, c.decided_at, ${CLAIM_REASON_SQL},
            c.claimant_user_id, cu.full_name AS claimant_name, cu.email AS claimant_email,
            c.description AS message,
            (SELECT COUNT(*) FROM claim_photos p WHERE p.claim_id = c.claim_id) AS photo_count
       FROM claims c
       JOIN users cu ON cu.user_id = c.claimant_user_id
      WHERE c.report_id = ?
      ORDER BY c.created_at DESC, c.claim_id DESC`, [id]);
  res.ok({ items: rows, total: rows.length });
});

/* GET /api/admin/claims  ?status=&q=&limit=&offset=  */
exports.claims = wrap(async (req, res) => {
  const { limit, offset } = v.paging(req.query);
  const where = [], params = [];
  if (req.query.status && req.query.status !== 'all') { where.push('c.status = ?'); params.push(v.oneOf(req.query.status, ['pending', 'approved', 'rejected'], 'status')); }
  if (req.query.q && String(req.query.q).trim()) {
    where.push('(cu.full_name LIKE ? OR cu.email LIKE ? OR r.pet_name LIKE ? OR ru.full_name LIKE ?)');
    params.push(...Array(4).fill(like(req.query.q)));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const joins = `FROM claims c
       JOIN pet_reports r ON r.report_id = c.report_id
       JOIN users cu ON cu.user_id = c.claimant_user_id
       JOIN users ru ON ru.user_id = r.user_id`;
  const [rows] = await pool.query(
    `SELECT c.claim_id AS id, c.claim_type AS type, c.status, c.created_at, c.decided_at, ${CLAIM_REASON_SQL},
            c.report_id, r.report_type, r.pet_name AS report_pet_name, r.user_id AS report_user_id,
            ru.full_name AS report_owner_name, cu.full_name AS claimant_name, cu.email AS claimant_email,
            (SELECT COUNT(*) FROM claim_photos p WHERE p.claim_id = c.claim_id) AS photo_count
       ${joins} ${whereSql} ORDER BY c.created_at DESC, c.claim_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${joins} ${whereSql}`, params);
  res.ok({ items: rows, total, limit, offset });
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

/* GET /api/admin/logs ?q=&action=&from=&to=&limit=&offset= */
exports.logs = wrap(async (req, res) => {
  const { limit, offset } = v.paging(req.query, 25);
  const where = [], params = [], q = req.query;
  if (q.user_id) { where.push('l.user_id = ?'); params.push(v.id(q.user_id, 'user_id')); }
  if (q.action) { where.push('l.action LIKE ?'); params.push(like(q.action)); }
  if (q.target_table) { where.push('l.target_table = ?'); params.push(String(q.target_table).slice(0, 40)); }
  if (q.target_id) { where.push('l.target_id = ?'); params.push(v.id(q.target_id, 'target_id')); }
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) { where.push('l.created_at >= ?'); params.push(`${q.from} 00:00:00`); }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) { where.push('l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
  if (q.q && String(q.q).trim()) {
    where.push(`(u.full_name LIKE ? OR u.email LIKE ? OR l.action LIKE ? OR l.target_table LIKE ?
      OR CAST(l.target_id AS CHAR) LIKE ? OR CAST(l.details AS CHAR) LIKE ?)`);
    params.push(...Array(6).fill(like(q.q)));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const joins = 'FROM activity_logs l LEFT JOIN users u ON u.user_id = l.user_id';
  const [rows] = await pool.query(
    `SELECT l.log_id AS id, l.user_id, u.full_name AS user_name, u.email AS user_email,
            l.action, l.target_table, l.target_id, l.details, l.created_at
       ${joins} ${whereSql} ORDER BY l.log_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${joins} ${whereSql}`, params);
  res.ok({ items: rows, total, limit, offset });
});