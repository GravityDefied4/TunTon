/* Shared report queries (plan 4.3 task 6: radius search, candidate lookup, per-barangay).
   Reports are read through one projection that NEVER selects contact details (plan rule 5;
   same columns as the v_public_reports view). Points are built with
   ST_GeomFromText('POINT(lng lat)', 4326, 'axis-order=long-lat') because MySQL 8 reads
   SRID 4326 coordinates as lat,lng unless told otherwise. */
const pool = require('./pool');

const FROM = `FROM pet_reports r
  JOIN species sp ON sp.species_id = r.species_id
  JOIN breeds br ON br.breed_id = r.breed_id
  LEFT JOIN barangays bg ON bg.barangay_id = r.barangay_id`;

const COLS = `r.report_id, r.user_id, r.report_type, r.pet_name, r.species_id, sp.name AS species,
  r.breed_id, br.name AS breed, br.is_unknown AS breed_unknown, r.size, r.sex, r.age_group, r.markings,
  r.description, r.event_date, r.lat, r.lng, r.barangay_id, bg.name AS barangay, r.search_radius_km,
  r.status, r.created_at, r.updated_at`;

const POINT = "ST_GeomFromText(?, 4326, 'axis-order=long-lat')";
const pointWkt = (lat, lng) => `POINT(${Number(lng)} ${Number(lat)})`;   // numbers only: no injection path
const DIST_KM = `(ST_Distance_Sphere(r.location, ${POINT}) / 1000)`;

const photoUrl = file => `/uploads/reports/${file}`;

/* Barangay for a pin: the polygon that contains it (when boundaries are loaded), otherwise the
   nearest barangay centre. schema.sql allows boundary to be NULL, so both rules are needed. */
async function nearestBarangayId(lat, lng, db = pool) {
  const wkt = pointWkt(lat, lng);
  const [inside] = await db.query(
    `SELECT barangay_id FROM barangays WHERE boundary IS NOT NULL AND ST_Contains(boundary, ${POINT}) LIMIT 1`, [wkt]);
  if (inside[0]) return inside[0].barangay_id;
  const [rows] = await db.query(
    `SELECT barangay_id FROM barangays ORDER BY ST_Distance_Sphere(center, ${POINT}) LIMIT 1`, [wkt]);
  return rows[0]?.barangay_id ?? null;
}

/* Turn raw rows into API objects: adds photos and colors with two extra queries total. */
async function hydrate(rows, viewerId = null, db = pool) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.report_id);
  const [photos] = await db.query(
    'SELECT photo_id, report_id, file_path, is_primary FROM report_photos WHERE report_id IN (?) ORDER BY is_primary DESC, photo_id', [ids]);
  const [colors] = await db.query(
    `SELECT rc.report_id, c.color_id, c.name, rc.is_primary FROM report_colors rc
       JOIN colors c ON c.color_id = rc.color_id WHERE rc.report_id IN (?) ORDER BY rc.is_primary DESC, c.name`, [ids]);
  const by = (list, id) => list.filter(x => x.report_id === id);
  return rows.map(r => {
    const { report_id, report_type, breed_unknown, ...rest } = r;
    const ph = by(photos, report_id).map(p => ({ photo_id: p.photo_id, url: photoUrl(p.file_path), is_primary: !!p.is_primary }));
    return {
      id: report_id, type: report_type, ...rest,
      breed_unknown: !!breed_unknown,
      distance_km: r.distance_km === undefined ? undefined : Math.round(r.distance_km * 100) / 100,
      colors: by(colors, report_id).map(c => ({ color_id: c.color_id, name: c.name, is_primary: !!c.is_primary })),
      photos: ph,
      primary_photo: ph[0]?.url ?? null,
      is_mine: viewerId != null && String(r.user_id) === String(viewerId)
    };
  });
}

/* Generic finder. where/params are caller-built fragments using r., sp., br., bg. aliases.
   origin {lat,lng} adds distance_km; maxKm filters by it. Removed reports are hidden unless includeRemoved. */
async function findReports({ where = [], params = [], origin, maxKm, orderBy = 'r.event_date DESC, r.report_id DESC',
  limit = 50, offset = 0, includeRemoved = false, extraCols = '', extraJoins = '', viewerId = null } = {}, db = pool) {
  const conds = [...where], condParams = [...params];
  if (!includeRemoved) conds.push("r.status <> 'removed'");
  if (origin && maxKm != null) { conds.push(`${DIST_KM} <= ?`); condParams.push(pointWkt(origin.lat, origin.lng), maxKm); }
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const distCol = origin ? `, ${DIST_KM} AS distance_km` : '';
  const selParams = origin ? [pointWkt(origin.lat, origin.lng)] : [];
  const [rows] = await db.query(
    `SELECT ${COLS}${distCol}${extraCols ? ', ' + extraCols : ''} ${FROM} ${extraJoins} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...selParams, ...condParams, limit, offset]);
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${FROM} ${extraJoins} ${whereSql}`, condParams);
  return { items: await hydrate(rows, viewerId, db), total, limit, offset };
}

async function findReportById(id, { viewerId = null, includeRemoved = false } = {}, db = pool) {
  const { items } = await findReports({ where: ['r.report_id = ?'], params: [id], limit: 1, includeRemoved, viewerId }, db);
  return items[0] || null;
}

/* Raw attribute rows the matching engine needs (colors as ids, location, status). */
async function loadForMatching(reportId, db = pool) {
  const [rows] = await db.query(
    `SELECT r.report_id, r.user_id, r.report_type AS type, r.species_id, r.breed_id, br.is_unknown AS breed_unknown,
            r.size, r.sex, r.age_group, r.markings, r.event_date, r.lat, r.lng, r.search_radius_km, r.status
       FROM pet_reports r JOIN breeds br ON br.breed_id = r.breed_id WHERE r.report_id = ?`, [reportId]);
  if (!rows[0]) return null;
  const [colors] = await db.query('SELECT color_id, is_primary FROM report_colors WHERE report_id = ?', [reportId]);
  return { ...rows[0], breed_unknown: !!rows[0].breed_unknown,
    primary_color_id: colors.find(c => c.is_primary)?.color_id ?? null,
    color_ids: colors.map(c => c.color_id) };
}

module.exports = { pointWkt, POINT, DIST_KM, photoUrl, nearestBarangayId, hydrate, findReports, findReportById, loadForMatching };
