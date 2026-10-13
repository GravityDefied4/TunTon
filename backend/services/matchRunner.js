/* Database side of matching (plan P4). Finds candidates with SQL (hard filters), scores them with
   the pure functions in services/matching.js, upserts matches >= threshold, and removes stale
   suggestions. Dismissed / claim_pending / confirmed matches are never touched. */
const pool = require('../db/pool');
const { withTransaction, logActivity } = require('../db/activityLog');
const { loadForMatching, pointWkt, POINT } = require('../db/reportQueries');
const { CONFIG, isCandidate, scoreMatch } = require('./matching');

/* SQL pre-filter: same hard rules as isCandidate(), so we only load plausible rows.
   (isCandidate runs again in JS as the final word.) */
async function candidateIds(report, db) {
  const buffer = CONFIG.dateBufferDays;
  const here = pointWkt(report.lat, report.lng);
  if (report.type === 'lost') {
    const [rows] = await db.query(
      `SELECT f.report_id FROM pet_reports f
        WHERE f.report_type = 'found' AND f.status = 'active' AND f.species_id = ? AND f.user_id <> ?
          AND f.event_date >= DATE_SUB(?, INTERVAL ? DAY)
          AND ST_Distance_Sphere(f.location, ${POINT}) <= ? * 1000`,
      [report.species_id, report.user_id, report.event_date, buffer, here, report.search_radius_km]);
    return rows.map(r => r.report_id);
  }
  const [rows] = await db.query(
    `SELECT l.report_id FROM pet_reports l
      WHERE l.report_type = 'lost' AND l.status = 'active' AND l.species_id = ? AND l.user_id <> ?
        AND l.event_date <= DATE_ADD(?, INTERVAL ? DAY)
        AND ST_Distance_Sphere(l.location, ${POINT}) <= l.search_radius_km * 1000`,
    [report.species_id, report.user_id, report.event_date, buffer, here]);
  return rows.map(r => r.report_id);
}

/* Recompute every match for one report. Returns { created, updated, removed, matches: [{match_id, lost, found, score, label}] }. */
async function runForReport(reportId, actorId = null) {
  return withTransaction(async conn => {
    const report = await loadForMatching(reportId, conn);
    if (!report) return null;

    const side = report.type === 'lost' ? 'lost_report_id' : 'found_report_id';
    const keep = [];
    const out = { created: 0, updated: 0, removed: 0, matches: [] };

    /* mysql2 reports affectedRows = 1 for an unchanged duplicate too, so "new vs existing" is decided up front. */
    const [existing] = await conn.query(`SELECT lost_report_id, found_report_id FROM matches WHERE ${side} = ?`, [reportId]);
    const known = new Set(existing.map(m => `${m.lost_report_id}-${m.found_report_id}`));

    if (report.status === 'active') {
      for (const otherId of await candidateIds(report, conn)) {
        const other = await loadForMatching(otherId, conn);
        const [lost, found] = report.type === 'lost' ? [report, other] : [other, report];
        if (!other || !isCandidate(lost, found)) continue;
        const { score, label } = scoreMatch(lost, found);
        if (score < CONFIG.threshold) continue;

        /* Upsert on the unique (lost, found) pair so re-running never duplicates. Status is left alone. */
        const [r] = await conn.query(
          `INSERT INTO matches (lost_report_id, found_report_id, score) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE score = VALUES(score), match_id = LAST_INSERT_ID(match_id)`,
          [lost.report_id, found.report_id, score]);
        const matchId = r.insertId;
        keep.push(matchId);
        if (!known.has(`${lost.report_id}-${found.report_id}`)) {
          out.created++;
          await logActivity({ userId: actorId, action: 'match_created', table: 'matches', id: matchId,
            details: { lost_report_id: lost.report_id, found_report_id: found.report_id, score, label } }, conn);
        } else out.updated++;
        out.matches.push({ match_id: matchId, lost_report_id: lost.report_id, found_report_id: found.report_id, score, label });
      }
    }

    /* Suggestions that no longer qualify (report edited, closed, or score dropped) are removed. */
    const [del] = await conn.query(
      `DELETE FROM matches WHERE ${side} = ? AND status = 'suggested'${keep.length ? ' AND match_id NOT IN (?)' : ''}`,
      keep.length ? [reportId, keep] : [reportId]);
    out.removed = del.affectedRows;
    return out;
  });
}

/* Fire-and-forget safe wrapper for report create/edit: a matching hiccup must not fail the request. */
async function runQuietly(reportId, actorId) {
  try { return await runForReport(reportId, actorId); }
  catch (e) { console.error(`[matching] report ${reportId} failed:`, e.message); return null; }
}

module.exports = { runForReport, runQuietly };
