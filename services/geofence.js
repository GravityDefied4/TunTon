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
   MySQL POINT takes longitude FIRST:  ST_SRID(POINT(lng, lat), 4326). */

module.exports = { DAGUPAN_BOUNDS, DAGUPAN_CENTER, RADIUS_KM, isInsideDagupan, isValidRadius, distanceKm };
