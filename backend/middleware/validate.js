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

/* One "contact" box that takes a phone number OR an email address (pet_reports.contact and claims.contact are VARCHAR(50)).
   Phone: spaces / hyphens are dropped and +63 9XX... becomes 09XX..., the same single stored form as users.phone
   (09 + 9 digits). Email: lowercased, must look like name@domain.tld. Empty -> null when optional. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function contact(value, label = 'contact', { max = 50, required = false } = {}) {
  const raw = text(value, label, { max: 200, required });
  if (raw === null) return null;
  if (raw.includes('@')) {
    if (!EMAIL_RE.test(raw)) throw bad(`${label} must be a valid email address or a phone number (09XXXXXXXXX).`);
    if (raw.length > max) throw bad(`${label} is too long (max ${max} characters).`);
    return raw.toLowerCase();
  }
  const phone = raw.replace(/[\s-]/g, '').replace(/^\+?63(?=9\d{9}$)/, '0');   // "+63 917 123 4567" -> "09171234567"
  if (!/^09\d{9}$/.test(phone)) throw bad(`${label} must be a phone number (09XXXXXXXXX or +63 9XX XXX XXXX) or an email address.`);
  return phone;
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

module.exports = { bad, id, oneOf, text, contact, date, paging };