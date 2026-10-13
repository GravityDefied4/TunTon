/* matches controller: business logic lives here, routes only map URLs (plan rule 2).
   Matches expose both reports side by side but never contact details (plan rule 5). */
const pool = require('../db/pool');
const { withTransaction, logActivity } = require('../db/activityLog');
const rq = require('../db/reportQueries');
const { wrap } = require('../middleware/errorHandler');
const v = require('../middleware/validate');
const { runForReport } = require('../services/matchRunner');
const { scoreMatch } = require('../services/matching');

const STATUSES = ['suggested', 'dismissed', 'claim_pending', 'confirmed'];

const SELECT = `SELECT m.match_id, m.lost_report_id, m.found_report_id, m.score, m.label, m.status, m.created_at, m.updated_at,
    lr.user_id AS lost_user_id, fr.user_id AS found_user_id,
    (SELECT c.claim_id FROM claims c WHERE c.match_id = m.match_id ORDER BY c.claim_id DESC LIMIT 1) AS claim_id,
    (SELECT c.status FROM claims c WHERE c.match_id = m.match_id ORDER BY c.claim_id DESC LIMIT 1) AS claim_status
  FROM matches m
  JOIN pet_reports lr ON lr.report_id = m.lost_report_id
  JOIN pet_reports fr ON fr.report_id = m.found_report_id`;

/* Hide matches on removed reports, and open suggestions whose reports are no longer active. */
const VISIBLE = `lr.status <> 'removed' AND fr.status <> 'removed'
  AND NOT (m.status = 'suggested' AND (lr.status <> 'active' OR fr.status <> 'active'))`;

/* Raw rows -> API items with both reports attached (one extra query for all of them). */
async function shape(rows, user) {
  const ids = [...new Set(rows.flatMap(r => [r.lost_report_id, r.found_report_id]))];
  const { items } = ids.length
    ? await rq.findReports({ where: ['r.report_id IN (?)'], params: [ids], limit: ids.length, includeRemoved: true, viewerId: user.user_id })
    : { items: [] };
  const byId = new Map(items.map(r => [r.id, r]));
  return rows.map(r => ({
    id: r.match_id, score: r.score, label: r.label, status: r.status,
    my_role: r.lost_user_id === user.user_id ? 'owner' : r.found_user_id === user.user_id ? 'finder' : null,
    claim: r.claim_id ? { id: r.claim_id, status: r.claim_status } : null,
    created_at: r.created_at, updated_at: r.updated_at,
    lost: byId.get(r.lost_report_id), found: byId.get(r.found_report_id)
  }));
}

const involved = (m, user) => m.lost_user_id === user.user_id || m.found_user_id === user.user_id;
const notFound = () => Object.assign(new Error('Match not found.'), { status: 404 });

/* POST /api/matching/run/:reportId  Recompute matches for a report (owner or admin) */
exports.run = wrap(async (req, res) => {
  const reportId = v.id(req.params.reportId, 'report id');
  const [[report]] = await pool.query('SELECT user_id, status FROM pet_reports WHERE report_id = ?', [reportId]);
  if (!report || (report.status === 'removed' && req.user.role !== 'admin')) throw notFound();
  if (report.user_id !== req.user.user_id && req.user.role !== 'admin') throw Object.assign(new Error('You can only run matching for your own reports.'), { status: 403 });
  const result = await runForReport(reportId, req.user.user_id);
  res.ok(result, `Matching done: ${result.created} new, ${result.updated} refreshed, ${result.removed} removed.`);
});

/* GET /api/matches/mine  Matches for my reports. Optional: status (default: all except dismissed, or "all"),
   as=owner|finder, min_score, limit, offset. */
exports.mine = wrap(async (req, res) => {
  const { limit, offset } = v.paging(req.query);
  const where = ['(lr.user_id = ? OR fr.user_id = ?)', VISIBLE], params = [req.user.user_id, req.user.user_id];
  const status = req.query.status || 'open';
  if (status === 'open') where.push("m.status <> 'dismissed'");
  else if (status !== 'all') { where.push('m.status = ?'); params.push(v.oneOf(status, STATUSES, 'status')); }
  if (req.query.as) {
    v.oneOf(req.query.as, ['owner', 'finder'], 'as');
    where.push(req.query.as === 'owner' ? 'lr.user_id = ?' : 'fr.user_id = ?'); params.push(req.user.user_id);
  }
  if (req.query.min_score !== undefined) {
    const n = Number(req.query.min_score);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw v.bad('min_score must be 0 to 100.');
    where.push('m.score >= ?'); params.push(n);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [rows] = await pool.query(`${SELECT} ${whereSql} ORDER BY m.score DESC, m.match_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM matches m JOIN pet_reports lr ON lr.report_id = m.lost_report_id
    JOIN pet_reports fr ON fr.report_id = m.found_report_id ${whereSql}`, params);
  res.ok({ items: await shape(rows, req.user), total, limit, offset });
});

/* GET /api/matches/:id  Match details side by side, with the score breakdown (involved users or admin) */
exports.getOne = wrap(async (req, res) => {
  const [rows] = await pool.query(`${SELECT} WHERE m.match_id = ?`, [v.id(req.params.id, 'match id')]);
  const m = rows[0];
  const isAdmin = req.user.role === 'admin';
  if (!m || !(involved(m, req.user) || isAdmin)) throw notFound();
  const [match] = await shape([m], req.user);
  if (!isAdmin && (match.lost?.status === 'removed' || match.found?.status === 'removed')) throw notFound();

  const [lost, found] = await Promise.all([rq.loadForMatching(m.lost_report_id), rq.loadForMatching(m.found_report_id)]);
  const { breakdown } = scoreMatch(lost, found);
  res.ok({ match: { ...match, breakdown } });
});

/* PATCH /api/matches/:id/dismiss  Dismiss a suggestion (involved users) */
exports.dismiss = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'match id');
  await withTransaction(async conn => {
    const [rows] = await conn.query(`${SELECT} WHERE m.match_id = ?`, [id]);
    const m = rows[0];
    if (!m || !involved(m, req.user)) throw notFound();
    if (m.status !== 'suggested') throw Object.assign(new Error(`Only suggested matches can be dismissed (this one is ${m.status}).`), { status: 409 });
    await conn.query("UPDATE matches SET status = 'dismissed' WHERE match_id = ? AND status = 'suggested'", [id]);
    await logActivity({ userId: req.user.user_id, action: 'match_dismissed', table: 'matches', id }, conn);
  });
  res.ok({ id, status: 'dismissed' }, 'Match dismissed.');
});
