/* claims controller: business logic lives here, routes only map URLs (plan rule 2).
   A claim is a response to an EXISTING report:
     - on a LOST report  -> "I found this pet"   (claim_type found_it)
     - on a FOUND report -> "This is my pet"     (claim_type my_pet)
   The owner of the report sees the claim (with the claimant's contact details) and approves or rejects it.
     pending -> approved : the claim stays on the report, which becomes 'matched'; other pending claims are rejected.
     pending -> rejected : the claim disappears from the report (only the claimant and admins can still see it).
   Every step is written to activity_logs. */
const pool = require('../db/pool');
const { withTransaction, logActivity } = require('../db/activityLog');
const rq = require('../db/reportQueries');
const { wrap } = require('../middleware/errorHandler');
const { checkFiles } = require('../middleware/upload');
const v = require('../middleware/validate');
const { isInsideDagupan } = require('../services/geofence');
const { runQuietly } = require('../services/matchRunner');

const MAX_PHOTOS = 3;
const SIZES = ['small', 'medium', 'large', 'extra_large'];
const TYPE_FOR = { lost: 'found_it', found: 'my_pet' };   // report type -> what a claim on it means
const PET_KEYS = ['pet_name', 'species', 'breed', 'color', 'size'];

const err = (status, message) => Object.assign(new Error(message), { status });
const photoUrl = name => `/uploads/claims/${name}`;

/* One claim row with the claimant and the report it sits on. */
const SELECT = `SELECT c.*, bg.name AS barangay,
    cu.full_name AS claimant_name, cu.email AS claimant_email, cu.phone AS claimant_phone,
    r.user_id AS report_user_id, r.report_type, r.status AS report_status
  FROM claims c
  JOIN pet_reports r ON r.report_id = c.report_id
  JOIN users cu ON cu.user_id = c.claimant_user_id
  LEFT JOIN barangays bg ON bg.barangay_id = c.barangay_id`;

/* Rows -> API objects. Contact details are public to every logged-in user (product decision), so anyone who can see a claim sees how to reach the claimant. */
async function shape(rows, user, db = pool) {
  if (!rows.length) return [];
  const [photos] = await db.query(
    'SELECT photo_id, claim_id, file_path FROM claim_photos WHERE claim_id IN (?) ORDER BY photo_id', [rows.map(r => r.claim_id)]);
  return rows.map(r => {
    const owner = r.report_user_id === user.user_id, mine = r.claimant_user_id === user.user_id;
    const pet = typeof r.pet === 'string' ? JSON.parse(r.pet) : r.pet;
    return {
      id: r.claim_id, report_id: r.report_id, type: r.claim_type, status: r.status, is_mine: mine,
      created_at: r.created_at, updated_at: r.updated_at,
      claimant: { id: r.claimant_user_id, name: r.claimant_name },
      description: r.description, markings: r.markings, pet_location: r.pet_location,
      event_date: r.event_date, lat: r.lat, lng: r.lng, barangay: r.barangay, pet: pet || null,
      photos: photos.filter(p => p.claim_id === r.claim_id).map(p => ({ photo_id: p.photo_id, url: photoUrl(p.file_path) })),
      decision_reason: owner || mine || user.role === 'admin' ? r.decision_reason : null,
      decided_at: r.decided_at,
      contact: { text: r.contact, facebook: r.facebook, phone: r.claimant_phone, email: r.claimant_email }
    };
  });
}

async function loadOne(claimId, user, db = pool) {
  const [rows] = await db.query(SELECT + ' WHERE c.claim_id = ?', [claimId]);
  return (await shape(rows, user, db))[0] || null;
}

const intList = (value, label) => {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map(x => v.id(String(x).trim(), label));
};
const blank = x => x === undefined || x === null || String(x).trim() === '';

/* Fields a claim can carry. Only keys that were sent are returned, so an edit can change just some of them. */
function parseFields(body = {}, type) {
  const out = {}, has = k => body[k] !== undefined;
  if (has('description')) out.description = v.text(body.description, 'description', { max: 2000 });
  if (has('markings')) out.markings = v.text(body.markings, 'markings', { max: 500 });
  if (has('pet_location')) out.pet_location = v.text(body.pet_location, 'pet_location', { max: 255 });
  if (has('contact')) out.contact = v.text(body.contact, 'contact', { max: 255 });
  if (has('facebook')) out.facebook = v.text(body.facebook, 'facebook', { max: 255 });
  if (has('event_date')) out.event_date = blank(body.event_date) ? null : v.date(String(body.event_date).trim(), 'event_date');
  if (has('lat') || has('lng')) {
    if (blank(body.lat) && blank(body.lng)) { out.lat = null; out.lng = null; }
    else {
      const lat = Number(body.lat), lng = Number(body.lng);
      if (blank(body.lat) || blank(body.lng) || !Number.isFinite(lat) || !Number.isFinite(lng) || !isInsideDagupan(lat, lng)) throw v.bad('The location must be a pin inside Dagupan.');
      out.lat = lat; out.lng = lng;
    }
  }
  if (type === 'my_pet' && PET_KEYS.some(has)) {
    const pet = {};
    const set = (k, val) => { if (val) pet[k] = val; };
    set('name', v.text(body.pet_name, 'pet_name', { max: 60 }));
    set('species', v.text(body.species, 'species', { max: 40 }));
    set('breed', v.text(body.breed, 'breed', { max: 60 }));
    set('color', v.text(body.color, 'color', { max: 60 }));
    if (!blank(body.size)) set('size', v.oneOf(String(body.size).trim(), SIZES, 'size'));
    out.pet = Object.keys(pet).length ? pet : null;
  }
  return out;
}

/* Column values for INSERT / UPDATE: JSON is serialised, and a pin becomes its barangay. */
async function toColumns(fields, db) {
  const cols = { ...fields };
  if ('pet' in cols) cols.pet = cols.pet ? JSON.stringify(cols.pet) : null;
  if ('lat' in cols) cols.barangay_id = cols.lat == null ? null : await rq.nearestBarangayId(cols.lat, cols.lng, db);
  return cols;
}

const hasContent = (c, photoCount) => !!(c.description || c.markings || c.pet || photoCount);
const NEEDS_CONTENT = 'Add a photo or describe the pet so the owner can check.';

/* POST /api/claims  multipart or JSON: report_id, description?, markings?, pet_location?, event_date?, lat?, lng?,
   contact?, facebook?, photos (up to 3), and for "This is my pet": pet_name?, species?, breed?, color?, size?.
   The type of claim follows the type of the report. */
exports.create = wrap(async (req, res) => {
  const files = req.files || [];
  const reportId = v.id(req.body?.report_id, 'report_id');
  if (!(await checkFiles(files))) throw v.bad('One of the files is not a valid image.');

  const claimId = await withTransaction(async conn => {
    const [[report]] = await conn.query('SELECT report_id, user_id, report_type, status FROM pet_reports WHERE report_id = ? FOR UPDATE', [reportId]);
    if (!report || report.status === 'removed') throw err(404, 'Report not found.');
    if (report.user_id === req.user.user_id) throw err(403, 'You cannot send a claim on your own report.');
    if (report.status !== 'active') throw err(409, 'This report is no longer open for claims.');
    const [[dup]] = await conn.query('SELECT status FROM claims WHERE report_id = ? AND claimant_user_id = ?', [reportId, req.user.user_id]);
    if (dup) throw err(409, dup.status === 'rejected' ? 'The owner of this report marked your claim as not a match.' : 'You already sent a claim on this report. Edit it instead.');

    const type = TYPE_FOR[report.report_type];
    const fields = parseFields(req.body, type);
    if (!hasContent(fields, files.length)) throw v.bad(NEEDS_CONTENT);
    const cols = { report_id: reportId, claimant_user_id: req.user.user_id, claim_type: type, ...await toColumns(fields, conn) };
    const keys = Object.keys(cols);
    const [r] = await conn.query(`INSERT INTO claims (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => cols[k]));
    if (files.length) await conn.query('INSERT INTO claim_photos (claim_id, file_path, image_data, mime_type) VALUES ?', [files.map(f => [r.insertId, f.filename, f.buffer, f.mimetype])]);
    await logActivity({ userId: req.user.user_id, action: 'claim_created', table: 'claims', id: r.insertId, details: { report_id: reportId, type } }, conn);
    return r.insertId;
  });
  res.status(201);
  res.ok({ claim: await loadOne(claimId, req.user) }, 'Claim sent. The owner of the report will review it.');
});

/* PUT /api/claims/:id  Edit your own claim while it is still pending. Send only what changes;
   add photos in "photos", delete with remove_photo_ids ("4,5"). */
exports.update = wrap(async (req, res) => {
  const files = req.files || [];
  const claimId = v.id(req.params.id, 'claim id');
  const removeIds = intList(req.body?.remove_photo_ids, 'remove_photo_ids');
  if (!(await checkFiles(files))) throw v.bad('One of the files is not a valid image.');

  await withTransaction(async conn => {
    const [[c]] = await conn.query(
      `SELECT c.claim_id, c.claimant_user_id, c.status, c.claim_type, r.status AS report_status
         FROM claims c JOIN pet_reports r ON r.report_id = c.report_id WHERE c.claim_id = ? FOR UPDATE`, [claimId]);
    if (!c || c.claimant_user_id !== req.user.user_id) throw err(404, 'Claim not found.');
    if (c.status !== 'pending') throw err(409, 'Only a claim that is still waiting can be edited.');
    if (c.report_status !== 'active') throw err(409, 'This report is no longer open for claims.');

    const [own] = await conn.query('SELECT photo_id FROM claim_photos WHERE claim_id = ?', [claimId]);
    if (removeIds.some(id => !own.some(p => p.photo_id === id))) throw v.bad('remove_photo_ids contains a photo that is not on this claim.');
    const photoCount = own.length - removeIds.length + files.length;
    if (photoCount > MAX_PHOTOS) throw v.bad(`A claim can have at most ${MAX_PHOTOS} photos.`);

    const cols = await toColumns(parseFields(req.body, c.claim_type), conn);
    const keys = Object.keys(cols);
    if (keys.length) await conn.query(`UPDATE claims SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE claim_id = ?`, [...keys.map(k => cols[k]), claimId]);
    if (removeIds.length) await conn.query('DELETE FROM claim_photos WHERE claim_id = ? AND photo_id IN (?)', [claimId, removeIds]);
    if (files.length) await conn.query('INSERT INTO claim_photos (claim_id, file_path, image_data, mime_type) VALUES ?', [files.map(f => [claimId, f.filename, f.buffer, f.mimetype])]);

    const [[now]] = await conn.query('SELECT description, markings, pet FROM claims WHERE claim_id = ?', [claimId]);
    if (!hasContent(now, photoCount)) throw v.bad(NEEDS_CONTENT);
    await logActivity({ userId: req.user.user_id, action: 'claim_updated', table: 'claims', id: claimId }, conn);
  });
  res.ok({ claim: await loadOne(claimId, req.user) }, 'Claim updated.');
});

/* DELETE /api/claims/:id  Withdraw your own claim while it is still pending. */
exports.withdraw = wrap(async (req, res) => {
  const claimId = v.id(req.params.id, 'claim id');
  await withTransaction(async conn => {
    const [[c]] = await conn.query('SELECT claim_id, report_id, claimant_user_id, status FROM claims WHERE claim_id = ? FOR UPDATE', [claimId]);
    if (!c || c.claimant_user_id !== req.user.user_id) throw err(404, 'Claim not found.');
    if (c.status !== 'pending') throw err(409, 'Only a claim that is still waiting can be withdrawn.');
    await conn.query('DELETE FROM claims WHERE claim_id = ?', [claimId]);   // photos cascade
    await logActivity({ userId: req.user.user_id, action: 'claim_withdrawn', table: 'claims', id: claimId, details: { report_id: c.report_id } }, conn);
  });
  res.ok({ id: claimId }, 'Claim withdrawn.');
});

/* GET /api/reports/:id/claims  Claims on one report.
   Everybody who is logged in sees the pending and approved claims on a report, with the claimant's contact details.
   Rejected claims never show on the report (the claimant still sees their own). */
exports.forReport = wrap(async (req, res) => {
  const reportId = v.id(req.params.id, 'report id');
  const [[report]] = await pool.query('SELECT report_id, user_id, status FROM pet_reports WHERE report_id = ?', [reportId]);
  if (!report || (report.status === 'removed' && req.user.role !== 'admin')) throw err(404, 'Report not found.');

  const [rows] = await pool.query(
    `${SELECT} WHERE c.report_id = ? AND (c.status IN ('pending', 'approved') OR c.claimant_user_id = ?)
      ORDER BY (c.status = 'approved') DESC, c.created_at DESC, c.claim_id DESC`,
    [reportId, req.user.user_id]);
  const items = await shape(rows, req.user);
  res.ok({ items, total: items.length });
});

/* GET /api/claims/mine  Claims I sent (any status, so I can see a rejection), with a short summary of each report. */
exports.mine = wrap(async (req, res) => {
  const [rows] = await pool.query(`${SELECT} WHERE c.claimant_user_id = ? AND r.status <> 'removed' ORDER BY c.created_at DESC, c.claim_id DESC`, [req.user.user_id]);
  const items = await shape(rows, req.user);
  const ids = [...new Set(items.map(c => c.report_id))];
  const { items: reports } = ids.length
    ? await rq.findReports({ where: ['r.report_id IN (?)'], params: [ids], limit: ids.length, viewerId: req.user.user_id })
    : { items: [] };
  res.ok({
    items: items.map(c => {
      const r = reports.find(x => x.id === c.report_id);
      return { ...c, report: r ? { id: r.id, type: r.type, pet_name: r.pet_name, species: r.species, status: r.status, primary_photo: r.primary_photo } : null };
    }),
    total: items.length
  });
});

/* GET /api/claims/:id  The claimant, the owner of the report, or an admin. */
exports.getOne = wrap(async (req, res) => {
  const claim = await loadOne(v.id(req.params.id, 'claim id'), req.user);
  const [[r]] = claim ? await pool.query('SELECT user_id FROM pet_reports WHERE report_id = ?', [claim.report_id]) : [[]];
  if (!claim || !(claim.is_mine || r?.user_id === req.user.user_id || req.user.role === 'admin')) throw err(404, 'Claim not found.');
  res.ok({ claim });
});

/* PATCH /api/claims/:id/decision  { decision: 'approve' | 'reject', reason? }  Owner of the report only.
   approve: the claim is approved and stays on the report, the report becomes 'matched' (found and returned),
            and every other pending claim on the report is rejected.
   reject:  the claim is rejected and disappears from the report. */
exports.decide = wrap(async (req, res) => {
  const claimId = v.id(req.params.id, 'claim id');
  const decision = v.oneOf(req.body?.decision, ['approve', 'reject'], 'decision');
  const reason = v.text(req.body?.reason, 'reason', { max: 500 });
  let reportId;

  await withTransaction(async conn => {
    const [[c]] = await conn.query(
      `SELECT c.claim_id, c.report_id, c.claimant_user_id, c.status, c.claim_type, r.user_id AS report_user_id, r.status AS report_status
         FROM claims c JOIN pet_reports r ON r.report_id = c.report_id WHERE c.claim_id = ? FOR UPDATE`, [claimId]);
    if (!c || (c.report_user_id !== req.user.user_id && c.claimant_user_id !== req.user.user_id)) throw err(404, 'Claim not found.');
    if (c.report_user_id !== req.user.user_id) throw err(403, 'Only the owner of the report can approve or reject a claim.');
    if (c.status !== 'pending') throw err(409, `This claim is already ${c.status}.`);
    reportId = c.report_id;

    if (decision === 'approve') {
      if (c.report_status !== 'active') throw err(409, 'This report is no longer open.');
      await conn.query("UPDATE claims SET status = 'approved', decision_reason = ?, decided_at = NOW() WHERE claim_id = ?", [reason, claimId]);
      await conn.query("UPDATE pet_reports SET status = 'matched' WHERE report_id = ?", [reportId]);
      const [others] = await conn.query(
        "UPDATE claims SET status = 'rejected', decision_reason = 'Another claim on this report was approved.', decided_at = NOW() WHERE report_id = ? AND status = 'pending' AND claim_id <> ?", [reportId, claimId]);
      await logActivity({ userId: req.user.user_id, action: 'claim_approved', table: 'claims', id: claimId,
        details: { report_id: reportId, type: c.claim_type, other_claims_rejected: others.affectedRows } }, conn);
    } else {
      await conn.query("UPDATE claims SET status = 'rejected', decision_reason = ?, decided_at = NOW() WHERE claim_id = ?", [reason, claimId]);
      await logActivity({ userId: req.user.user_id, action: 'claim_rejected', table: 'claims', id: claimId, details: { report_id: reportId, type: c.claim_type, reason } }, conn);
    }
  });
  if (decision === 'approve') await runQuietly(reportId, req.user.user_id);   // a matched report keeps no open match suggestions
  res.ok({ claim: await loadOne(claimId, req.user) }, decision === 'approve' ? 'Claim approved. The report is marked as found.' : 'Claim rejected.');
});