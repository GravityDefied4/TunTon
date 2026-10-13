/* Geofence rules (plan section 5.1, P3). Pure functions, easy to test. */

/* Rough bounding box of Dagupan City. Verify on the map and adjust. */
const DAGUPAN_BOUNDS = { minLat: 16.00, maxLat: 16.12, minLng: 120.30, maxLng: 120.42 };
const DAGUPAN_CENTER = { lat: 16.043, lng: 120.333 };
const RADIUS_KM = { min: 1, max: 5 };

const isInsideDagupan = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= DAGUPAN_BOUNDS.minLat && lat <= DAGUPAN_BOUNDS.maxLat &&
  lng >= DAGUPAN_BOUNDS.minLng && lng <= DAGUPAN_BOUNDS.maxLng;

const isValidRadius = km => Number.isFinite(km) && km >= RADIUS_KM.min && km <= RADIUS_KM.max;

/* Great-circle distance in km (haversine). */
function distanceKm(a, b) {
  const r = x => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/* Convention (plan reminder): the API sends lat and lng as separate fields.
   MySQL POINT takes longitude FIRST, and SRID 4326 is read as lat,lng unless told otherwise, so
   build points with:  ST_GeomFromText('POINT(lng lat)', 4326, 'axis-order=long-lat')
   (db/reportQueries.js pointWkt() does this). ST_SRID(POINT(lng, lat), 4326) fails in MySQL 8. */

/* Validate a pin from request input. Returns { lat, lng } or throws a 400. */
function parsePin(latRaw, lngRaw) {
  const lat = Number(latRaw), lng = Number(lngRaw);
  if (latRaw === undefined || lngRaw === undefined || latRaw === '' || lngRaw === '' || !Number.isFinite(lat) || !Number.isFinite(lng))
    throw Object.assign(new Error('lat and lng are required numbers.'), { status: 400 });
  if (!isInsideDagupan(lat, lng))
    throw Object.assign(new Error('That location is outside Dagupan City. Please pin a place inside the city.'), { status: 400 });
  return { lat, lng };
}

/* Search radius 1 to 5 km (whole or half numbers allowed for filters; reports store whole km). */
function parseRadius(raw) {
  const km = Number(raw);
  if (raw === undefined || raw === '' || !isValidRadius(km))
    throw Object.assign(new Error(`radius must be a number from ${RADIUS_KM.min} to ${RADIUS_KM.max} (km).`), { status: 400 });
  return km;
}

module.exports = { DAGUPAN_BOUNDS, DAGUPAN_CENTER, RADIUS_KM, isInsideDagupan, isValidRadius, distanceKm, parsePin, parseRadius };
