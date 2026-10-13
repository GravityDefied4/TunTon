/* Small input helpers shared by controllers. Each throws a 400 error (handled by errorHandler). */
const bad = message => Object.assign(new Error(message), { status: 400 });

/* Positive integer from a route param or body field. */
function id(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw bad(`Invalid ${label}.`);
  return n;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw bad(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
}

/* Trimmed string. Empty -> null when optional. */
function text(value, label, { max = 1000, required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw bad(`${label} is required.`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw bad(`${label} is too long (max ${max} characters).`);
  return s;
}

/* Real calendar date as YYYY-MM-DD, not in the future. */
function date(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw bad(`${label} must be a date (YYYY-MM-DD).`);
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw bad(`${label} is not a valid date.`);
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw bad(`${label} cannot be in the future.`);
  return value;
}

/* Page window from ?limit=&offset= (limit 1..100, default 20). */
function paging(query, def = 20) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || def, 1), 100);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

module.exports = { bad, id, oneOf, text, date, paging };
