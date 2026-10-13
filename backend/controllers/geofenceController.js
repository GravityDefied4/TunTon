/* geofence controller: business logic lives here, routes only map URLs (plan rule 2). */
const pool = require('../db/pool');
const rq = require('../db/reportQueries');
const { wrap } = require('../middleware/errorHandler');
const v = require('../middleware/validate');
const { parsePin, parseRadius } = require('../services/geofence');

const STATUSES = ['active', 'matched', 'resolved', 'closed'];

function listFilters(q) {
  const where = [], params = [];
  if (q.type) { v.oneOf(q.type, ['lost', 'found'], 'type'); where.push('r.report_type = ?'); params.push(q.type); }
  if (q.species) {
    if (/^\d+$/.test(q.species)) { where.push('r.species_id = ?'); params.push(Number(q.species)); }
    else { where.push('sp.name = ?'); params.push(String(q.species)); }
  }
  const status = q.status || 'active';
  if (status !== 'all') { v.oneOf(status, STATUSES, 'status'); where.push('r.status = ?'); params.push(status); }
  return { where, params };
}

/* GET /api/geofence/nearby  ?lat=&lng=&radius= (radius 1 to 5, inside Dagupan). Optional: type, species, status, limit, offset.
   Nearest first, each report carries distance_km. Map pages can ask for up to 100 at once. */
exports.nearby = wrap(async (req, res) => {
  const origin = parsePin(req.query.lat, req.query.lng);
  const radiusKm = parseRadius(req.query.radius);
  const { where, params } = listFilters(req.query);
  const out = await rq.findReports({
    where, params, origin, maxKm: radiusKm, ...v.paging(req.query, 100),
    orderBy: 'distance_km ASC, r.report_id DESC', viewerId: req.user.user_id
  });
  res.ok({ center: origin, radius_km: radiusKm, ...out });
});

/* GET /api/geofence/barangays  Barangay list and boundaries.
   boundary is GeoJSON (coordinates [lng, lat]) or null when the database team has not loaded a polygon yet. */
exports.barangays = wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.barangay_id AS id, b.name, ST_Latitude(b.center) AS lat, ST_Longitude(b.center) AS lng,
            IF(b.boundary IS NULL, NULL, ST_AsGeoJSON(b.boundary, 6)) AS boundary,
            (SELECT COUNT(*) FROM pet_reports r WHERE r.barangay_id = b.barangay_id AND r.status = 'active') AS active_reports
       FROM barangays b ORDER BY b.name`);
  res.ok({ items: rows.map(r => ({ ...r, boundary: r.boundary ? (typeof r.boundary === 'string' ? JSON.parse(r.boundary) : r.boundary) : null })) });
});

/* GET /api/geofence/barangay/:id/reports  Reports inside a zone (optional: type, species, status, limit, offset) */
exports.barangayReports = wrap(async (req, res) => {
  const id = v.id(req.params.id, 'barangay id');
  const [[barangay]] = await pool.query(
    'SELECT barangay_id AS id, name, ST_Latitude(center) AS lat, ST_Longitude(center) AS lng FROM barangays WHERE barangay_id = ?', [id]);
  if (!barangay) return res.fail(404, 'Barangay not found.');
  const { where, params } = listFilters(req.query);
  where.push('r.barangay_id = ?'); params.push(id);
  const out = await rq.findReports({ where, params, ...v.paging(req.query, 100), viewerId: req.user.user_id });
  res.ok({ barangay, ...out });
});
