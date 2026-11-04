/* reports controller: business logic lives here, routes only map URLs (plan rule 2).
   Contact details (phone, email) are never selected here (plan rule 5). */
const fs = require('fs/promises');
const path = require('path');
const pool = require('../db/pool');
const { withTransaction, logActivity } = require('../db/activityLog');
const rq = require('../db/reportQueries');
const { wrap } = require('../middleware/errorHandler');
const { checkFiles, discardFiles, UPLOAD_ROOT } = require('../middleware/upload');
const v = require('../middleware/validate');
const { parsePin, parseRadius, DAGUPAN_BOUNDS, DAGUPAN_CENTER, RADIUS_KM } = require('../services/geofence');
const { runQuietly } = require('../services/matchRunner');
const { splitColors } = require('../services/matching');

const REQUIRE_PHOTO = true;      // plan open decision 4 suggests: at least one photo per report
const MAX_PHOTOS = 5;
const SIZES = ['small', 'medium', 'large', 'extra_large'];
const SEXES = ['male', 'female', 'unknown'];
const SPECIES_SUGGESTIONS = ['Dog', 'Cat', 'Other'];
const COLOR_SUGGESTIONS = ['Black', 'White', 'Brown', 'Gray', 'Orange', 'Cream', 'Golden', 'Tan', 'Red', 'Tricolor', 'Brindle', 'Spotted'];
const PHONE_RE = /^(\+63|09)[0-9]{9}$/;                    // same rule as the chk_users_phone constraint
const PUBLIC_STATUSES = ['active', 'matched', 'resolved', 'closed'];

/* "1,2" | "[1,2]" | [1,2] | "1" -> [1,2] (multipart forms send everything as strings). Used for photo ids. */
function intList(raw, label) {
  if (raw === undefined || raw === null || raw === '') return [];
  let arr = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    try { arr = t.startsWith('[') ? JSON.parse(t) : t.split(','); } catch { throw v.bad(`${label} is not a valid list.`); }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const out = arr.map(x => Number(x));
  if (out.some(n => !Number.isInteger(n) || n <= 0)) throw v.bad(`${label} must be a list of ids.`);
  return [...new Set(out)];
}

/* pet_reports.color is ONE text column (VARCHAR 50). Accepts "Black and White", ["Black","White"], '["Black","White"]' or
   "Black, White" and stores them as "Black and White" (the shape the frontend already shows). */
function colorText(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) { try { list = JSON.parse(t); } catch { throw v.bad('color is not a valid list.'); } }
  }
  const names = (Array.isArray(list) ? list : [list]).flatMap(c => String(c ?? '').split(/\s*(?:,|\/|&|\+|;|\band\b)\s*/i))
    .map(c => c.trim()).filter(Boolean);
  const unique = names.filter((c, i) => names.findIndex(x => x.toLowerCase() === c.toLowerCase()) === i);
  if (!unique.length) throw v.bad('color is required.');
  if (unique.length > 4) throw v.bad('Pick at most 4 colors.');
  const out = unique.join(' and ');
  if (out.length > 50) throw v.bad('color is too long (max 50 characters).');
  return out;
}

/* Optional contact details stored on the report itself (phone, facebook_profile_link). Never returned by the public projection. */
function contactFields(src) {
  const c = {};
  if (src.phone !== undefined) {
    const p = v.text(src.phone, 'phone', { max: 15 });
    if (p && !PHONE_RE.test(p)) throw v.bad('phone must look like 09XXXXXXXXX or +63XXXXXXXXXX.');
    c.phone = p;
  }
  if (src.facebook_profile_link !== undefined) {
    const l = v.text(src.facebook_profile_link, 'facebook_profile_link', { max: 255 });
    if (l && !/^https?:\/\//i.test(l)) throw v.bad('facebook_profile_link must be a web address (https://...).');
    c.facebook_profile_link = l;
  }
  return c;
}

/* Validate a full set of report fields (used by create, and by update after merging with the stored row). */
async function normalize(src, type, db = pool) {
  const f = {};
  f.pet_name = v.text(src.pet_name, 'pet_name', { max: 60, required: type === 'lost' }) || 'Unknown';   // pet_name is NOT NULL; a finder may not know it
  f.species = v.text(src.species, 'species', { max: 50, required: true });
  f.breed = v.text(src.breed, 'breed', { max: 50 }) || 'Unknown';   // breed is NOT NULL in the schema
  f.color = colorText(src.colors !== undefined && src.color === undefined ? src.colors : src.color);

  f.size = v.oneOf(src.size, SIZES, 'size');
  f.sex = v.oneOf(src.sex || 'unknown', SEXES, 'sex');
  f.markings = v.text(src.markings, 'markings', { max: 1000 });
  f.description = v.text(src.description, 'description', { max: 2000 });
  f.event_date = v.date(src.event_date, 'event_date');
  Object.assign(f, parsePin(src.lat, src.lng));

  if (type === 'lost') {
    const km = Number(src.search_radius_km);
    if (!Number.isInteger(km) || km < RADIUS_KM.min || km > RADIUS_KM.max) throw v.bad('search_radius_km is required for lost reports (whole number, 1 to 5).');
    f.search_radius_km = km;
  } else f.search_radius_km = null;                        // schema CHECK: found reports have no radius

  f.barangay_id = null;
  if (src.barangay_id !== undefined && src.barangay_id !== null && src.barangay_id !== '') {
    f.barangay_id = v.id(src.barangay_id, 'barangay_id');
    const [b] = await db.query('SELECT 1 FROM barangays WHERE barangay_id = ?', [f.barangay_id]);
    if (!b.length) throw v.bad('Unknown barangay.');
  }

  Object.assign(f, contactFields(src));
  return f;
}

const COLUMNS = ['pet_name', 'species', 'breed', 'color', 'size', 'sex', 'markings', 'description',
  'event_date', 'search_radius_km', 'barangay_id'];
const CONTACT_COLUMNS = ['phone', 'facebook_profile_link'];   // not in the public projection, so only written when sent

const ownerOnly = (report, user) => {
  if (!report) throw Object.assign(new Error('Report not found.'), { status: 404 });
  if (report.user_id !== user.user_id) throw Object.assign(new Error('You can only change your own reports.'), { status: 403 });
};

/* GET /api/reports/lookups  What the report form needs. species / breed / color are free text now (the lookup tables
   were removed), so species and colors are only suggestions; barangays still come from the database. */
exports.lookups = wrap(async (req, res) => {
  const [barangays] = await pool.query('SELECT barangay_id, name, ST_Latitude(center) AS lat, ST_Longitude(center) AS lng FROM barangays ORDER BY name');
  res.ok({
    species: SPECIES_SUGGESTIONS.map(name => ({ name })), colors: COLOR_SUGGESTIONS.map(name => ({ name })), barangays,
    sizes: SIZES, sexes: SEXES, statuses: PUBLIC_STATUSES,
    radius_km: RADIUS_KM, bounds: DAGUPAN_BOUNDS, center: DAGUPAN_CENTER, max_photos: MAX_PHOTOS
  });
});

/* POST /api/reports/  Create report (multipart with photos in field "photos") */
exports.create = wrap(async (req, res) => {
  const files = req.files || [];
  try {
    const type = v.oneOf(req.body.type, ['lost', 'found'], 'type');
    if (REQUIRE_PHOTO && !files.length) throw v.bad('Please add at least one photo.');
    if (!(await checkFiles(files))) throw v.bad('One of the files is not a valid image.');
    const f = await normalize(req.body, type);

    const id = await withTransaction(async conn => {
      const barangayId = f.barangay_id ?? await rq.nearestBarangayId(f.lat, f.lng, conn);
      const [r] = await conn.query(
        `INSERT INTO pet_reports (user_id, report_type, pet_name, species, breed, color, size, sex, markings,
           description, event_date, location, barangay_id, search_radius_km, phone, facebook_profile_link)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${rq.POINT}, ?, ?, ?, ?)`,
        [req.user.user_id, type, f.pet_name, f.species, f.breed, f.color, f.size, f.sex, f.markings,
          f.description, f.event_date, rq.pointWkt(f.lat, f.lng), barangayId, f.search_radius_km,
          f.phone ?? null, f.facebook_profile_link ?? null]);
      if (files.length) {
        await conn.query('INSERT INTO report_photos (report_id, file_path, image_data, mime_type, is_primary) VALUES ?',
          [files.map((file, i) => [r.insertId, file.filename, file.buffer, file.mimetype, i === 0])]);
      }
      await logActivity({ userId: req.user.user_id, action: 'report_created', table: 'pet_reports', id: r.insertId, details: { type } }, conn);
      return r.insertId;
    });

    const matching = await runQuietly(id, req.user.user_id);
    res.status(201);
    res.ok({ report: await rq.findReportById(id, { viewerId: req.user.user_id }), matches: matching?.matches ?? [] }, 'Report created.');
  } catch (e) { await discardFiles(files); throw e; }
});

/* Builds the WHERE for list-style endpoints from the query string. */
function filtersFrom(q, { allowAnyStatus = false } = {}) {
  const where = [], params = [];
  if (q.type) { v.oneOf(q.type, ['lost', 'found'], 'type'); where.push('r.report_type = ?'); params.push(q.type); }
  if (q.species) { where.push('r.species = ?'); params.push(String(q.species).trim()); }   // case-insensitive collation
  const status = q.status || 'active';
  if (status !== 'all') {
    v.oneOf(status, allowAnyStatus ? [...PUBLIC_STATUSES, 'removed'] : PUBLIC_STATUSES, 'status');
    where.push('r.status = ?'); params.push(status);
  }
  if (q.size) { v.oneOf(q.size, SIZES, 'size'); where.push('r.size = ?'); params.push(q.size); }
  if (q.barangay_id) { where.push('r.barangay_id = ?'); params.push(v.id(q.barangay_id, 'barangay_id')); }
  if (q.color && String(q.color).trim()) {
    where.push('r.color LIKE ?');
    params.push('%' + String(q.color).trim().slice(0, 50).replace(/[\\%_]/g, '\\$&') + '%');
  }
  if (q.q && String(q.q).trim()) {
    const like = '%' + String(q.q).trim().slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';
    where.push('(r.pet_name LIKE ? OR r.markings LIKE ? OR r.description LIKE ? OR r.breed LIKE ? OR r.species LIKE ? OR r.color LIKE ? OR bg.name LIKE ?)');
    params.push(like, like, like, like, like, like, like);
  }
  return { where, params };
}

/* Optional radius search: ?lat=&lng=&radius= (all three or none). */
function originFrom(q) {
  if (q.lat === undefined && q.lng === undefined && q.radius === undefined) return {};
  const origin = parsePin(q.lat, q.lng);
  return { origin, maxKm: parseRadius(q.radius) };
}

/* GET /api/reports/  List with filters: type, species, status, size, color, barangay_id, q, lat+lng+radius, limit, offset */
exports.list = wrap(async (req, res) => {
  const { where, params } = filtersFrom(req.query);
  const geo = originFrom(req.query);
  const out = await rq.findReports({
    where, params, ...geo, ...v.paging(req.query),
    orderBy: geo.origin ? 'distance_km ASC, r.report_id DESC' : 'r.event_date DESC, r.report_id DESC',
    viewerId: req.user.user_id
  });
  res.ok(out);
});

/* GET /api/reports/public?status=active|resolved&limit=  No login. Feeds the home page preview.
   Only fields safe for anonymous visitors are returned: no owner id, exact coordinates, markings
   (used for claim verification) or free-text description. */
exports.publicPreview = wrap(async (req, res) => {
  const status = v.oneOf(req.query.status || 'active', ['active', 'resolved'], 'status');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 30);
  const out = await rq.findReports({ where: ['r.status = ?'], params: [status], limit, offset: 0,
    orderBy: 'r.event_date DESC, r.report_id DESC' });
  res.ok({
    total: out.total,
    items: out.items.map(r => ({
      id: r.id, type: r.type, pet_name: r.pet_name, species: r.species, breed: r.breed, breed_unknown: r.breed_unknown,
      colors: r.colors.map(c => ({ name: c.name })), barangay: r.barangay, event_date: r.event_date,
      status: r.status, created_at: r.created_at, primary_photo: r.primary_photo
    }))
  });
});

/* GET /api/reports/mine  Own reports (must stay above /:id) */
exports.mine = wrap(async (req, res) => {
  const { where, params } = filtersFrom({ ...req.query, status: req.query.status || 'all' }, { allowAnyStatus: true });
  where.push('r.user_id = ?'); params.push(req.user.user_id);
  const out = await rq.findReports({
    where, params, ...v.paging(req.query), includeRemoved: true, viewerId: req.user.user_id,
    orderBy: 'r.created_at DESC, r.report_id DESC',
    extraCols: `(SELECT COUNT(*) FROM matches m WHERE (m.lost_report_id = r.report_id OR m.found_report_id = r.report_id)
                   AND m.status <> 'dismissed') AS match_count`
  });
  res.ok(out);
});

/* GET /api/reports/:id  Details (contact info hidden) */
exports.getOne = wrap(async (req, res) => {
  const report = await rq.findReportById(v.id(req.params.id), { viewerId: req.user.user_id, includeRemoved: true });
  const visible = report && (report.status !== 'removed' || report.is_mine || req.user.role === 'admin');
  if (!visible) return res.fail(404, 'Report not found.');
  res.ok({ report });
});

/* PUT /api/reports/:id  Update own active report. Send only the fields that change (multipart or JSON).
   Photos: add with "photos" files, remove with remove_photo_ids. The report type cannot change. */
exports.update = wrap(async (req, res) => {
  const files = req.files || [];
  let removedFiles = [];
  try {
    const id = v.id(req.params.id);
    const existing = await rq.findReportById(id, { viewerId: req.user.user_id, includeRemoved: true });
    ownerOnly(existing, req.user);
    if (existing.status !== 'active') throw Object.assign(new Error('Only active reports can be edited.'), { status: 409 });
    if (!(await checkFiles(files))) throw v.bad('One of the files is not a valid image.');

    const body = req.body || {};
    const src = {
      ...Object.fromEntries(COLUMNS.map(k => [k, existing[k]])),
      lat: existing.lat, lng: existing.lng,
      ...Object.fromEntries([...COLUMNS, ...CONTACT_COLUMNS, 'lat', 'lng'].filter(k => k in body).map(k => [k, body[k]]))
    };
    /* Moving the pin re-derives the barangay unless the client picked one. */
    if (('lat' in body || 'lng' in body) && !('barangay_id' in body)) src.barangay_id = null;
    const f = await normalize(src, existing.type);

    const removeIds = intList(body.remove_photo_ids, 'remove_photo_ids');
    const ownPhotoIds = existing.photos.map(p => p.photo_id);
    if (removeIds.some(pid => !ownPhotoIds.includes(pid))) throw v.bad('remove_photo_ids contains a photo that is not on this report.');
    const remaining = existing.photos.length - removeIds.length + files.length;
    if (remaining > MAX_PHOTOS) throw v.bad(`A report can have at most ${MAX_PHOTOS} photos.`);
    if (REQUIRE_PHOTO && remaining < 1) throw v.bad('A report needs at least one photo.');

    const contactSets = CONTACT_COLUMNS.filter(k => k in body);   // contact is not readable back, so it only changes when sent
    await withTransaction(async conn => {
      const barangayId = f.barangay_id ?? await rq.nearestBarangayId(f.lat, f.lng, conn);
      await conn.query(
        `UPDATE pet_reports SET pet_name = ?, species = ?, breed = ?, color = ?, size = ?, sex = ?, markings = ?,
           description = ?, event_date = ?, location = ${rq.POINT}, barangay_id = ?, search_radius_km = ?${contactSets.map(c => `, ${c} = ?`).join('')} WHERE report_id = ?`,
        [f.pet_name, f.species, f.breed, f.color, f.size, f.sex, f.markings, f.description, f.event_date,
          rq.pointWkt(f.lat, f.lng), barangayId, f.search_radius_km, ...contactSets.map(c => f[c]), id]);

      if (removeIds.length) {
        const [gone] = await conn.query('SELECT file_path FROM report_photos WHERE photo_id IN (?)', [removeIds]);
        removedFiles = gone.map(g => g.file_path);
        await conn.query('DELETE FROM report_photos WHERE photo_id IN (?) AND report_id = ?', [removeIds, id]);
      }
      if (files.length) {
        await conn.query('INSERT INTO report_photos (report_id, file_path, image_data, mime_type, is_primary) VALUES ?', [files.map(file => [id, file.filename, file.buffer, file.mimetype, false])]);
      }
      const [left] = await conn.query('SELECT photo_id, is_primary FROM report_photos WHERE report_id = ? ORDER BY photo_id', [id]);
      if (left.length && !left.some(p => p.is_primary)) await conn.query('UPDATE report_photos SET is_primary = TRUE WHERE photo_id = ?', [left[0].photo_id]);

      await logActivity({ userId: req.user.user_id, action: 'report_updated', table: 'pet_reports', id,
        details: { fields: COLUMNS.concat(CONTACT_COLUMNS, ['lat', 'lng']).filter(k => k in body) } }, conn);
    });

    await Promise.all(removedFiles.map(name => fs.unlink(path.join(UPLOAD_ROOT, 'reports', name)).catch(() => {})));
    const matching = await runQuietly(id, req.user.user_id);
    res.ok({ report: await rq.findReportById(id, { viewerId: req.user.user_id }), matches: matching?.matches ?? [] }, 'Report updated.');
  } catch (e) { await discardFiles(files); throw e; }
});

/* PATCH /api/reports/:id/status  { status: 'closed' | 'resolved' }  Owner only */
exports.setStatus = wrap(async (req, res) => {
  const id = v.id(req.params.id);
  const status = v.oneOf(req.body?.status, ['closed', 'resolved'], 'status');
  const report = await rq.findReportById(id, { includeRemoved: true });
  ownerOnly(report, req.user);
  if (!['active', 'matched'].includes(report.status)) throw Object.assign(new Error(`A ${report.status} report cannot be changed.`), { status: 409 });

  await withTransaction(async conn => {
    await conn.query('UPDATE pet_reports SET status = ? WHERE report_id = ?', [status, id]);
    await logActivity({ userId: req.user.user_id, action: 'report_status_changed', table: 'pet_reports', id,
      details: { from: report.status, to: status } }, conn);
  });
  await runQuietly(id, req.user.user_id);   // a non-active report keeps no open suggestions
  res.ok({ report: await rq.findReportById(id, { viewerId: req.user.user_id }) }, `Report ${status}.`);
});

/* DELETE /api/reports/:id  Permanently deletes the report from the database. Owner only.
   Its photos, match suggestions and the claims sent on it (with their photos) go with it (ON DELETE CASCADE).
   Photos are stored in the database; only older photos saved as files are removed from disk afterwards. */
exports.remove = wrap(async (req, res) => {
  const id = v.id(req.params.id);
  const report = await rq.findReportById(id, { includeRemoved: true });
  ownerOnly(report, req.user);

  let reportFiles = [];
  await withTransaction(async conn => {
    const [photos] = await conn.query('SELECT file_path FROM report_photos WHERE report_id = ?', [id]);
    reportFiles = photos.map(p => p.file_path);
    await conn.query('DELETE FROM pet_reports WHERE report_id = ?', [id]);          // photos, matches, claims cascade
    await logActivity({ userId: req.user.user_id, action: 'report_deleted', table: 'pet_reports', id,
      details: { type: report.type, status: report.status } }, conn);
  });

  await Promise.all(reportFiles.map(n => fs.unlink(path.join(UPLOAD_ROOT, 'reports', n)).catch(() => {})));
  res.ok({ id }, 'Report deleted.');
});