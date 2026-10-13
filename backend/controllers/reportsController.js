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

const REQUIRE_PHOTO = true;      // plan open decision 4 suggests: at least one photo per report
const MAX_PHOTOS = 5;
const SIZES = ['small', 'medium', 'large', 'extra_large'];
const SEXES = ['male', 'female', 'unknown'];
const AGES = ['baby', 'young', 'adult', 'senior', 'unknown'];
const PUBLIC_STATUSES = ['active', 'matched', 'resolved', 'closed'];

/* "1,2" | "[1,2]" | [1,2] | "1" -> [1,2] (multipart forms send everything as strings). */
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

/* Validate a full set of report fields (used by create, and by update after merging with the stored row). */
async function normalize(src, type, db = pool) {
  const f = {};
  f.pet_name = v.text(src.pet_name, 'pet_name', { max: 60 });
  f.species_id = v.id(src.species_id, 'species_id');
  f.breed_id = v.id(src.breed_id, 'breed_id');
  const [breed] = await db.query('SELECT 1 FROM breeds WHERE breed_id = ? AND species_id = ?', [f.breed_id, f.species_id]);
  if (!breed.length) throw v.bad('That breed does not belong to the chosen species.');

  f.size = v.oneOf(src.size, SIZES, 'size');
  f.sex = v.oneOf(src.sex || 'unknown', SEXES, 'sex');
  f.age_group = v.oneOf(src.age_group || 'unknown', AGES, 'age_group');
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

  f.color_ids = intList(src.color_ids, 'color_ids');
  if (!f.color_ids.length) throw v.bad('Pick at least one color.');
  if (f.color_ids.length > 4) throw v.bad('Pick at most 4 colors.');
  const [found] = await db.query('SELECT color_id FROM colors WHERE color_id IN (?)', [f.color_ids]);
  if (found.length !== f.color_ids.length) throw v.bad('Unknown color.');
  f.primary_color_id = src.primary_color_id ? v.id(src.primary_color_id, 'primary_color_id') : f.color_ids[0];
  if (!f.color_ids.includes(f.primary_color_id)) throw v.bad('primary_color_id must be one of color_ids.');
  return f;
}

const COLUMNS = ['pet_name', 'species_id', 'breed_id', 'size', 'sex', 'age_group', 'markings', 'description',
  'event_date', 'search_radius_km', 'barangay_id'];

async function writeColors(conn, reportId, f) {
  await conn.query('DELETE FROM report_colors WHERE report_id = ?', [reportId]);
  await conn.query('INSERT INTO report_colors (report_id, color_id, is_primary) VALUES ?',
    [f.color_ids.map(c => [reportId, c, c === f.primary_color_id])]);
}

const ownerOnly = (report, user) => {
  if (!report) throw Object.assign(new Error('Report not found.'), { status: 404 });
  if (report.user_id !== user.user_id) throw Object.assign(new Error('You can only change your own reports.'), { status: 403 });
};

/* GET /api/reports/lookups  Everything the report form needs (ids for species, breeds, colors, barangays). */
exports.lookups = wrap(async (req, res) => {
  const [species] = await pool.query('SELECT species_id, name FROM species ORDER BY name');
  const [breeds] = await pool.query('SELECT breed_id, species_id, name, is_unknown FROM breeds ORDER BY is_unknown, name');
  const [colors] = await pool.query('SELECT color_id, name FROM colors ORDER BY name');
  const [barangays] = await pool.query('SELECT barangay_id, name, ST_Latitude(center) AS lat, ST_Longitude(center) AS lng FROM barangays ORDER BY name');
  res.ok({
    species, breeds: breeds.map(b => ({ ...b, is_unknown: !!b.is_unknown })), colors, barangays,
    sizes: SIZES, sexes: SEXES, age_groups: AGES, statuses: PUBLIC_STATUSES,
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
        `INSERT INTO pet_reports (user_id, report_type, pet_name, species_id, breed_id, size, sex, age_group, markings,
           description, event_date, location, barangay_id, search_radius_km)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${rq.POINT}, ?, ?)`,
        [req.user.user_id, type, f.pet_name, f.species_id, f.breed_id, f.size, f.sex, f.age_group, f.markings,
          f.description, f.event_date, rq.pointWkt(f.lat, f.lng), barangayId, f.search_radius_km]);
      await writeColors(conn, r.insertId, f);
      if (files.length) {
        await conn.query('INSERT INTO report_photos (report_id, file_path, is_primary) VALUES ?',
          [files.map((file, i) => [r.insertId, file.filename, i === 0])]);
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
  if (q.species) {
    if (/^\d+$/.test(q.species)) { where.push('r.species_id = ?'); params.push(Number(q.species)); }
    else { where.push('sp.name = ?'); params.push(String(q.species)); }
  }
  const status = q.status || 'active';
  if (status !== 'all') {
    v.oneOf(status, allowAnyStatus ? [...PUBLIC_STATUSES, 'removed'] : PUBLIC_STATUSES, 'status');
    where.push('r.status = ?'); params.push(status);
  }
  if (q.size) { v.oneOf(q.size, SIZES, 'size'); where.push('r.size = ?'); params.push(q.size); }
  if (q.barangay_id) { where.push('r.barangay_id = ?'); params.push(v.id(q.barangay_id, 'barangay_id')); }
  if (q.color_id) {
    where.push('EXISTS (SELECT 1 FROM report_colors rc WHERE rc.report_id = r.report_id AND rc.color_id = ?)');
    params.push(v.id(q.color_id, 'color_id'));
  }
  if (q.q && String(q.q).trim()) {
    const like = '%' + String(q.q).trim().slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';
    where.push('(r.pet_name LIKE ? OR r.markings LIKE ? OR r.description LIKE ? OR br.name LIKE ? OR sp.name LIKE ? OR bg.name LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  return { where, params };
}

/* Optional radius search: ?lat=&lng=&radius= (all three or none). */
function originFrom(q) {
  if (q.lat === undefined && q.lng === undefined && q.radius === undefined) return {};
  const origin = parsePin(q.lat, q.lng);
  return { origin, maxKm: parseRadius(q.radius) };
}

/* GET /api/reports/  List with filters: type, species, status, size, color_id, barangay_id, q, lat+lng+radius, limit, offset */
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
      color_ids: existing.colors.map(c => c.color_id),
      primary_color_id: existing.colors.find(c => c.is_primary)?.color_id,
      ...Object.fromEntries(['type', ...COLUMNS, 'lat', 'lng', 'color_ids', 'primary_color_id'].filter(k => k in body && k !== 'type').map(k => [k, body[k]]))
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

    await withTransaction(async conn => {
      const barangayId = f.barangay_id ?? await rq.nearestBarangayId(f.lat, f.lng, conn);
      await conn.query(
        `UPDATE pet_reports SET pet_name = ?, species_id = ?, breed_id = ?, size = ?, sex = ?, age_group = ?, markings = ?,
           description = ?, event_date = ?, location = ${rq.POINT}, barangay_id = ?, search_radius_km = ? WHERE report_id = ?`,
        [f.pet_name, f.species_id, f.breed_id, f.size, f.sex, f.age_group, f.markings, f.description, f.event_date,
          rq.pointWkt(f.lat, f.lng), barangayId, f.search_radius_km, id]);
      await writeColors(conn, id, f);

      if (removeIds.length) {
        const [gone] = await conn.query('SELECT file_path FROM report_photos WHERE photo_id IN (?)', [removeIds]);
        removedFiles = gone.map(g => g.file_path);
        await conn.query('DELETE FROM report_photos WHERE photo_id IN (?) AND report_id = ?', [removeIds, id]);
      }
      if (files.length) {
        await conn.query('INSERT INTO report_photos (report_id, file_path, is_primary) VALUES ?', [files.map(file => [id, file.filename, false])]);
      }
      const [left] = await conn.query('SELECT photo_id, is_primary FROM report_photos WHERE report_id = ? ORDER BY photo_id', [id]);
      if (left.length && !left.some(p => p.is_primary)) await conn.query('UPDATE report_photos SET is_primary = TRUE WHERE photo_id = ?', [left[0].photo_id]);

      await logActivity({ userId: req.user.user_id, action: 'report_updated', table: 'pet_reports', id,
        details: { fields: COLUMNS.concat(['lat', 'lng', 'color_ids', 'primary_color_id']).filter(k => k in body) } }, conn);
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

  if (status === 'closed') {
    const [open] = await pool.query(
      `SELECT 1 FROM claims c JOIN matches m ON m.match_id = c.match_id
        WHERE (m.lost_report_id = ? OR m.found_report_id = ?) AND c.status IN ('pending_proof', 'under_review') LIMIT 1`, [id, id]);
    if (open.length) throw Object.assign(new Error('A claim on this report is still in progress. Finish it before closing.'), { status: 409 });
  }
  await withTransaction(async conn => {
    await conn.query('UPDATE pet_reports SET status = ? WHERE report_id = ?', [status, id]);
    await logActivity({ userId: req.user.user_id, action: 'report_status_changed', table: 'pet_reports', id,
      details: { from: report.status, to: status } }, conn);
  });
  await runQuietly(id, req.user.user_id);   // a non-active report keeps no open suggestions
  res.ok({ report: await rq.findReportById(id, { viewerId: req.user.user_id }) }, `Report ${status}.`);
});
