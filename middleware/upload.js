/* File uploads (plan: images only, max 5 MB, files renamed on save).
   Usage:  router.post('/', requireAuth, upload.reportPhotos, ctrl.create)  */
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_BYTES = 5 * 1024 * 1024;

const make = folder => multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads', folder),
    /* Never trust the original name: random name, extension from the verified MIME type. */
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype])
  }),
  limits: { fileSize: MAX_BYTES, files: 5 },
  fileFilter: (req, file, cb) =>
    ALLOWED[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Only JPG, PNG or WebP images are allowed.'), { status: 400 }))
});

module.exports = {
  reportPhotos: make('reports').array('photos', 5),   // POST /api/reports
  proofFiles: make('proofs').array('proofs', 3)       // POST /api/claims/:id/proofs
};
