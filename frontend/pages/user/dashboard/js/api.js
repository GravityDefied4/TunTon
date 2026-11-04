/* =========================================================
   Reports & Matches data layer.

   The pages never call fetch() directly. They call ReportsAPI and MatchesAPI,
   which talk to the Express backend:
     GET /api/reports
     GET /api/reports/mine
     GET /api/reports/:id
     GET /api/matches/mine
     GET /api/matches/:id
     POST /api/matching/run/:reportId
     PATCH /api/matches/:id/dismiss
   Reports and matches exist only if they are in the database.
   toReport() and loadReports() live in common.js.
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

  /* Get user's own reports from GET /api/reports/mine */
  async mine(filters = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.status) params.set('status', filters.status);
    params.set('limit', '100');
    const res = await authFetch(`/reports/mine?${params.toString()}`);
    if (!res.ok) throw new Error('Could not load your reports');
    const items = (await res.json()).data?.items || [];
    return items.map(toReport);
  },

  async get(id) {
    const res = await authFetch(`/reports/${encodeURIComponent(id)}`);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error('Could not load the report');
    const report = (await res.json()).data?.report;
    return report ? toReport(report) : null;
  }
};

const MatchesAPI = {
  /* List matches for the current user. Filters: { status, as, min_score, max_score, report_id, limit, offset } */
  async mine(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.as) params.set('as', filters.as);
    if (filters.min_score !== undefined && filters.min_score !== null) params.set('min_score', filters.min_score);
    if (filters.max_score !== undefined && filters.max_score !== null) params.set('max_score', filters.max_score);
    if (filters.report_id) params.set('report_id', filters.report_id);
    if (filters.limit) params.set('limit', filters.limit);
    if (filters.offset) params.set('offset', filters.offset);
    const qs = params.toString();
    const res = await authFetch(`/matches/mine${qs ? '?' + qs : ''}`);
    if (!res.ok) throw new Error('Could not load matches');
    const data = (await res.json()).data || {};
    return {
      items: (data.items || []).map(m => ({
        ...m,
        score: Number(m.score),
        lost: m.lost ? toReport(m.lost) : null,
        found: m.found ? toReport(m.found) : null
      })),
      total: data.total || 0,
      limit: data.limit,
      offset: data.offset
    };
  },

  /* Get match details with breakdown: GET /api/matches/:id */
  async get(id) {
    const res = await authFetch(`/matches/${encodeURIComponent(id)}`);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error('Could not load match details');
    const match = (await res.json()).data?.match;
    if (!match) return null;
    return {
      ...match,
      score: Number(match.score),
      lost: match.lost ? toReport(match.lost) : null,
      found: match.found ? toReport(match.found) : null
    };
  },

  /* Recompute matches for a report: POST /api/matching/run/:reportId */
  async run(reportId) {
    const res = await authFetch(`/matching/run/${encodeURIComponent(reportId)}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Could not compute matches');
    }
    return (await res.json()).data;
  },

  /* Dismiss a suggestion: PATCH /api/matches/:id/dismiss */
  async dismiss(id) {
    const res = await authFetch(`/matches/${encodeURIComponent(id)}/dismiss`, { method: 'PATCH' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Could not dismiss match');
    }
    return (await res.json()).data;
  }
};
