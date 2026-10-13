/* claims controller: business logic lives here, routes only map URLs (plan rule 2).
   Flow (plan 5.3): pending_proof -> (owner uploads proof) -> under_review -> approved | rejected.
   Contact details leave this file ONLY through exports.contact, and only for an approved claim.
   Every step is written to activity_logs. */
const pool = require('../db/pool');
const { withTransaction, logActivity } = require('../db/activityLog');
const rq = require('../db/reportQueries');
const { wrap } = require('../middleware/errorHandler');
const { checkFiles, discardFiles, UPLOAD_ROOT } = require('../middleware/upload');
const v = require('../middleware/validate');
const { runQuietly } = require('../services/matchRunner');

const MAX_SUBMISSIONS = 3;                       // plan: limit to 3 proof submissions per claim
const PROOF_TYPES = ['vet_record', 'older_photo', 'microchip_number', 'hidden_marks', 'other'];
const NEEDS_NOTE = ['microchip_number', 'hidden_marks'];   // these are text answers, a file alone is not enough

const err = (status, message) => Object.assign(new Error(message), { status });

const CLAIM_SQL = `SELECT c.claim_id, c.match_id, c.claimant_user_id, c.status, c.decision_reason, c.created_at, c.decided_at, c.decided_by,
    m.lost_report_id, m.found_report_id, m.status AS match_status, m.score, m.label,
    lr.status AS lost_status, fr.status AS found_status, fr.user_id AS finder_user_id
  FROM claims c
  JOIN matches m ON m.match_id = c.match_id
  JOIN pet_reports lr ON lr.report_id = m.lost_report_id
  JOIN pet_reports fr ON fr.report_id = m.found_report_id
  WHERE c.claim_id = ?`;

const roleOf = (c, user) =>
  c.claimant_user_id === user.user_id ? 'claimant' : c.finder_user_id === user.user_id ? 'finder' : user.role === 'admin' ? 'admin' : null;

async function loadClaim(id, db = pool, { lock = false } = {}) {
  const [rows] = await db.query(CLAIM_SQL + (lock ? ' FOR UPDATE OF c, m' : ''), [id]);
  return rows[0] || null;
}

/* Claim the caller may see, or a 404 (we do not reveal that other people's claims exist). */
async function loadInvolved(id, user, db = pool, opts) {
  const c = await loadClaim(id, db, opts);
  const role = c && roleOf(c, user);
  if (!role) throw err(404, 'Claim not found.');
  return { c, role };
}

const attemptsUsed = async (claimId, db) =>
  (await db.query('SELECT COALESCE(MAX(attempt_no), 0) AS n FROM claim_proofs WHERE claim_id = ?', [claimId]))[0][0].n;

/* Full claim view for the involved user: status, both reports (no contact info), proofs. */
async function describe(claimId, user) {
  const { c, role } = await loadInvolved(claimId, user);
  const [proofs] = await pool.query(
    'SELECT proof_id, attempt_no, proof_type, file_path, note, uploaded_at FROM claim_proofs WHERE claim_id = ? ORDER BY attempt_no, proof_id', [claimId]);
  const { items } = await rq.findReports({ where: ['r.report_id IN (?)'], params: [[c.lost_report_id, c.found_report_id]], limit: 2, includeRemoved: true, viewerId: user.user_id });
  const used = proofs.reduce((n, p) => Math.max(n, p.attempt_no), 0);
  return {
    id: c.claim_id, status: c.status, role, decision_reason: c.decision_reason,
    created_at: c.created_at, decided_at: c.decided_at, decided_by: c.decided_by,
    match: { id: c.match_id, score: c.score, label: c.label, status: c.match_status },
    lost: items.find(r => r.id === c.lost_report_id), found: items.find(r => r.id === c.found_report_id),
    proofs: proofs.map(p => ({
      id: p.proof_id, attempt_no: p.attempt_no, proof_type: p.proof_type, note: p.note, uploaded_at: p.uploaded_at,
      file_url: p.file_path ? `/api/claims/${claimId}/proofs/${p.proof_id}/file` : null
    })),
    attempts_used: used, attempts_left: Math.max(MAX_SUBMISSIONS - used, 0),
    can_submit_proof: role === 'claimant' && (c.status === 'pending_proof' || c.status === 'rejected') && used < MAX_SUBMISSIONS,
    contact_available: c.status === 'approved'
  };
}

/* POST /api/claims/  { match_id }  Start a claim ("This is my pet"). Only the owner of the lost report. */
exports.create = wrap(async (req, res) => {
  const matchId = v.id(req.body?.match_id, 'match_id');
  const claimId = await withTransaction(async conn => {
    const [rows] = await conn.query(
      `SELECT m.match_id, m.status, lr.user_id AS lost_user_id, lr.status AS lost_status, fr.status AS found_status
         FROM matches m JOIN pet_reports lr ON lr.report_id = m.lost_report_id JOIN pet_reports fr ON fr.report_id = m.found_report_id
        WHERE m.match_id = ? FOR UPDATE OF m`, [matchId]);
    const m = rows[0];
    if (!m) throw err(404, 'Match not found.');
    if (m.lost_user_id !== req.user.user_id) throw err(403, 'Only the owner of the lost report can start a claim.');
    if (m.status !== 'suggested') throw err(409, `This match cannot be claimed (it is ${m.status}).`);
    if (m.lost_status !== 'active' || m.found_status !== 'active') throw err(409, 'Both reports must still be active to start a claim.');

    const [r] = await conn.query('INSERT INTO claims (match_id, claimant_user_id) VALUES (?, ?)', [matchId, req.user.user_id]);
    await conn.query("UPDATE matches SET status = 'claim_pending' WHERE match_id = ?", [matchId]);
    await logActivity({ userId: req.user.user_id, action: 'claim_created', table: 'claims', id: r.insertId, details: { match_id: matchId } }, conn);
    return r.insertId;
  });
  res.status(201);
  res.ok({ claim: await describe(claimId, req.user) }, 'Claim started. Please upload your proof of ownership.');
});

/* POST /api/claims/:id/proofs  multipart: proof_type, note?, proofs (up to 3 files: JPG, PNG, WebP, PDF).
   One request = one submission (max 3 per claim). Moves the claim to under_review. */
exports.addProofs = wrap(async (req, res) => {
  const files = req.files || [];
  try {
    const claimId = v.id(req.params.id, 'claim id');
    const type = v.oneOf(req.body?.proof_type, PROOF_TYPES, 'proof_type');
    const note = v.text(req.body?.note, 'note', { max: 2000 });
    if (!files.length && !note) throw v.bad('Add a file or a note describing your proof.');
    if (NEEDS_NOTE.includes(type) && !note) throw v.bad(type === 'microchip_number' ? 'Please enter the microchip number in note.' : 'Please describe the hidden marks in note.');
    if (!(await checkFiles(files))) throw v.bad('One of the files is not a valid image or PDF.');

    await withTransaction(async conn => {
      const { c, role } = await loadInvolved(claimId, req.user, conn, { lock: true });
      if (role !== 'claimant') throw err(403, 'Only the person who made the claim can upload proof.');
      if (c.status === 'under_review') throw err(409, 'Your proof is already being reviewed.');
      if (c.status === 'approved') throw err(409, 'This claim is already approved.');
      if (c.lost_status !== 'active' || c.found_status !== 'active') throw err(409, 'This claim can no longer be changed because a report is no longer active.');
      const used = await attemptsUsed(claimId, conn);
      if (used >= MAX_SUBMISSIONS) throw err(409, `You have used all ${MAX_SUBMISSIONS} proof submissions for this claim.`);

      const attempt = used + 1;
      const rows = files.length
        ? files.map((f, i) => [claimId, attempt, type, f.filename, i === 0 ? note : null])
        : [[claimId, attempt, type, null, note]];
      await conn.query('INSERT INTO claim_proofs (claim_id, attempt_no, proof_type, file_path, note) VALUES ?', [rows]);
      await conn.query("UPDATE claims SET status = 'under_review', decision_reason = NULL, decided_at = NULL, decided_by = NULL WHERE claim_id = ?", [claimId]);
      await logActivity({ userId: req.user.user_id, action: 'proof_submitted', table: 'claims', id: claimId,
        details: { attempt_no: attempt, proof_type: type, files: files.length } }, conn);
    });
    res.status(201);
    res.ok({ claim: await describe(claimId, req.user) }, 'Proof submitted. The finder will review it.');
  } catch (e) { await discardFiles(files); throw e; }
});

/* GET /api/claims/:id  View claim status (claimant, finder or admin) */
exports.getOne = wrap(async (req, res) => {
  res.ok({ claim: await describe(v.id(req.params.id, 'claim id'), req.user) });
});

/* GET /api/claims/:id/proofs/:proofId/file  Private proof document (claimant, finder or admin). Needs the Bearer token. */
exports.proofFile = wrap(async (req, res) => {
  const claimId = v.id(req.params.id, 'claim id'), proofId = v.id(req.params.proofId, 'proof id');
  await loadInvolved(claimId, req.user);
  const [rows] = await pool.query('SELECT file_path FROM claim_proofs WHERE proof_id = ? AND claim_id = ? AND file_path IS NOT NULL', [proofId, claimId]);
  if (!rows[0]) throw err(404, 'File not found.');
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  res.sendFile(rows[0].file_path, { root: `${UPLOAD_ROOT}/proofs`, dotfiles: 'deny' }, e => { if (e && !res.headersSent) res.fail(404, 'File not found.'); });
});

/* PATCH /api/claims/:id/decision  { decision: 'approve' | 'reject', reason? }  Finder (or admin).
   reject needs a reason. The 3rd rejection is final: the match is dismissed and the claim is flagged for admins. */
exports.decide = wrap(async (req, res) => {
  const claimId = v.id(req.params.id, 'claim id');
  const decision = v.oneOf(req.body?.decision, ['approve', 'reject'], 'decision');
  const reason = v.text(req.body?.reason, 'reason', { max: 500, required: decision === 'reject' });
  let reports = [];

  await withTransaction(async conn => {
    const { c, role } = await loadInvolved(claimId, req.user, conn, { lock: true });
    if (role === 'claimant') throw err(403, 'Only the finder (or an admin) can decide on a claim.');
    const decidable = role === 'admin' ? ['under_review', 'rejected'] : ['under_review'];   // admin may override a rejection
    if (!decidable.includes(c.status)) throw err(409, `This claim is ${c.status.replace('_', ' ')} and cannot be decided now.`);
    reports = [c.lost_report_id, c.found_report_id];

    if (decision === 'approve') {
      if (!['active', 'matched'].includes(c.lost_status) || !['active', 'matched'].includes(c.found_status)) throw err(409, 'A report on this match is no longer open.');
      await conn.query("UPDATE claims SET status = 'approved', decision_reason = ?, decided_at = NOW(), decided_by = ? WHERE claim_id = ?", [reason, req.user.user_id, claimId]);
      await conn.query("UPDATE matches SET status = 'confirmed' WHERE match_id = ?", [c.match_id]);
      await conn.query("UPDATE pet_reports SET status = 'matched' WHERE report_id IN (?)", [reports]);
      await logActivity({ userId: req.user.user_id, action: 'claim_approved', table: 'claims', id: claimId, details: { by_role: role, match_id: c.match_id } }, conn);
    } else {
      await conn.query("UPDATE claims SET status = 'rejected', decision_reason = ?, decided_at = NOW(), decided_by = ? WHERE claim_id = ?", [reason, req.user.user_id, claimId]);
      await logActivity({ userId: req.user.user_id, action: 'claim_rejected', table: 'claims', id: claimId, details: { by_role: role, reason } }, conn);
      if (await attemptsUsed(claimId, conn) >= MAX_SUBMISSIONS) {
        await conn.query("UPDATE matches SET status = 'dismissed' WHERE match_id = ?", [c.match_id]);
        await logActivity({ userId: null, action: 'claim_flagged', table: 'claims', id: claimId,
          details: { reason: `All ${MAX_SUBMISSIONS} proof submissions were rejected`, claimant_user_id: c.claimant_user_id } }, conn);
      }
    }
  });
  if (decision === 'approve') await Promise.all(reports.map(id => runQuietly(id, req.user.user_id)));   // clears other open suggestions
  res.ok({ claim: await describe(claimId, req.user) }, decision === 'approve' ? 'Claim approved. Contact details are now released.' : 'Claim rejected.');
});

/* GET /api/claims/:id/contact  Released contact info, ONLY if approved.
   The claimant gets the finder's details, the finder gets the claimant's, an admin gets both. */
exports.contact = wrap(async (req, res) => {
  const claimId = v.id(req.params.id, 'claim id');
  const { c, role } = await loadInvolved(claimId, req.user);
  if (c.status !== 'approved') throw err(403, 'Contact details are only released after the claim is approved.');

  const [[row]] = await pool.query('SELECT * FROM v_released_contacts WHERE claim_id = ?', [claimId]);   // the view only lists approved claims
  if (!row) throw err(403, 'Contact details are only released after the claim is approved.');
  const claimant = { name: row.claimant_name, phone: row.claimant_phone, email: row.claimant_email };
  const finder = { name: row.finder_name, phone: row.finder_phone, email: row.finder_email };
  await logActivity({ userId: req.user.user_id, action: 'contact_viewed', table: 'claims', id: claimId, details: { role } });
  res.ok(role === 'claimant' ? { finder } : role === 'finder' ? { claimant } : { claimant, finder });
});
