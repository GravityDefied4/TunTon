/* Every API response uses one shape: { success, data, message } (plan rule 4). */
function responseHelpers(req, res, next) {
  res.ok = (data = null, message = '') => res.json({ success: true, data, message });
  res.fail = (status, message, data = null) => res.status(status).json({ success: false, data, message });
  next();
}

const notFound = (req, res) => res.fail(404, 'Not found.');

/* Wrap async route handlers so a thrown error reaches errorHandler (Express 4 does not do this). */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return res.fail(400, 'Invalid JSON.');
  if (err.code === 'LIMIT_FILE_SIZE') return res.fail(400, 'File is too large (max 5 MB).');
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.fail(400, 'Too many files, or a file was sent in the wrong field.');
  if (err.code === 'ER_DUP_ENTRY') return res.fail(409, 'That record already exists.');
  if (err.errno === 3819 || err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') return res.fail(400, 'Some values are not allowed. Please check your input.');
  if (err.status && err.status < 500) return res.fail(err.status, err.message);
  console.error(err);
  res.fail(500, 'Something went wrong.');
}

module.exports = { responseHelpers, notFound, errorHandler, wrap };
