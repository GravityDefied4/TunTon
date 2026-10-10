/* =========================================================
   Reports data layer (FRONTEND ONLY for now).

   The pages never read localStorage or call fetch() themselves for
   reports. They call ReportsAPI, so the backend can be plugged in
   later by changing this one file.

   When the Node.js + Express + MySQL backend exists:
     1. Set USE_API = true.
     2. Build these endpoints (nothing is built yet):
          GET /api/reports?type=lost|found&species=Dog&q=text
          GET /api/reports/:id
     3. Return rows shaped like PLACEHOLDER_ROW below.
   ========================================================= */

const USE_API = false;          // false = show the local placeholder data
const API_BASE = '/api';        // where Express will be mounted

/* One report row as MySQL would return it (snake_case column names).
   Not used while USE_API is false. */
const PLACEHOLDER_ROW = {
  id: 1,
  type: 'lost',                 // 'lost' | 'found'
  pet_name: 'Tabby cat',
  species: 'Cat',
  breed: '',
  color: 'Tabby',
  size: 'Small',
  markings: '',
  barangay: 'Tapuac',
  latitude: 16.0525,
  longitude: 120.3305,
  photo_url: '/uploads/reports/1.jpg',                          // main photo
  photo_urls: ['/uploads/reports/1.jpg', '/uploads/reports/1b.jpg'],  // all photos (first = main)
  date_reported: '2026-10-03',  // last seen / found date
  contact: '',
  status: 'active',             // 'active' | 'reunited'
  user_id: 1,
  created_at: '2026-10-03T08:00:00Z'
};

/* Converts a database row into the object the pages use. */
const toReport = row => ({
  id: String(row.id),
  kind: row.type,
  name: row.pet_name || '',
  species: row.species,
  breed: row.breed || '',
  color: row.color || '',
  size: row.size || '',
  markings: row.markings || '',
  brgy: row.barangay,
  lat: Number(row.latitude),
  lng: Number(row.longitude),
  photo: row.photo_url,
  photos: Array.isArray(row.photo_urls) && row.photo_urls.length ? row.photo_urls : [row.photo_url],
  date: String(row.date_reported).slice(0, 10),
  contact: row.contact || '',
  status: row.status,
  created: row.created_at ? Date.parse(row.created_at) : 0
});

/* Placeholder filtering (the real server would do this in SQL). */
const filterLocal = (list, { kind, species, q }) => {
  const needle = (q || '').toLowerCase();
  return list
    .filter(r => !kind || kind === 'all' || r.kind === kind)
    .filter(r => !species || r.species === species)
    .filter(r => !needle || [r.name, r.species, r.breed, r.color, r.markings, r.brgy].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || (b.created || 0) - (a.created || 0));
};

const ReportsAPI = {
  /* filters: { kind: 'all'|'lost'|'found', species: '', q: '' } */
  async list(filters = {}) {
    if (!USE_API) return filterLocal(allReports(), filters);
    const qs = new URLSearchParams();
    if (filters.kind && filters.kind !== 'all') qs.set('type', filters.kind);
    if (filters.species) qs.set('species', filters.species);
    if (filters.q) qs.set('q', filters.q);
    const res = await fetch(`${API_BASE}/reports?${qs}`);
    if (!res.ok) throw new Error('Could not load reports');
    return (await res.json()).map(toReport);
  },

  async get(id) {
    if (!USE_API) return allReports().find(r => r.id === id) || null;
    const res = await fetch(`${API_BASE}/reports/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Could not load the report');
    return toReport(await res.json());
  }
};