/* =========================================================
   Reports data layer.

   The pages never call fetch() for reports themselves. They call ReportsAPI,
   which reads the database through the Express backend:
     GET /api/reports        (list; the server pages at 100, loadReports() in common.js collects every page)
     GET /api/reports/:id
   Reports exist only if they are in the database: there is no sample or local data.
   toReport() and loadReports() (which turn API rows into page objects) live in common.js,
   because pages that do not load this file need them too.
   ========================================================= */

/* Client-side filtering on top of the database result (the database only has Dog and Cat,
   so "Other" and free-text search are handled here). */
const filterLocal = (list, { kind, species, q }) => {
  const needle = (q || '').toLowerCase();
  return list
    .filter(r => !kind || kind === 'all' || r.kind === kind)
    .filter(r => !species || r.species === species)
    .filter(r => !needle || [r.name, r.species, r.otherSpecies, r.breed, r.color, r.markings, r.description, r.howFound, r.brgy].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || (b.created || 0) - (a.created || 0));
};

const ReportsAPI = {
  /* filters: { kind: 'all'|'lost'|'found', species: '', q: '' }. Reloads from the database every call. */
  async list(filters = {}) {
    reportsReady = loadReports();
    reportsReady.catch(() => {});
    await reportsReady;
    return filterLocal(allReports(), filters);
  },

  async get(id) {
    const res = await authFetch(`/reports/${encodeURIComponent(id)}`);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error('Could not load the report');
    const report = (await res.json()).data?.report;
    return report ? toReport(report) : null;
  }
};