/* File uploads (plan: images only, max 5 MB, files renamed on save).
   Usage:  router.post('/', requireAuth, upload.reportPhotos, ctrl.create)
   After multer, controllers call checkFiles(req.files) (real file-type check) and
   discardFiles(req.files) if they reject the request, so no orphan files pile up. */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const IMAGES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const IMAGES_AND_PDF = { ...IMAGES, 'application/pdf': '.pdf' };   // vet records are often PDFs
const MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const make = (folder, allowed, message) => (require('fs').mkdirSync(path.join(UPLOAD_ROOT, folder), { recursive: true }), multer({
  storage: multer.diskStorage({
    destination: path.join(UPLOAD_ROOT, folder),
    /* Never trust the original name: random name, extension from the declared MIME type. */
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + allowed[file.mimetype])
  }),
  limits: { fileSize: MAX_BYTES, files: 5 },
  fileFilter: (req, file, cb) =>
    allowed[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error(message), { status: 400 }))
}));

/* Report photos are NOT written to disk: they are kept in memory and saved in the database
   (report_photos.image_data). Each file still gets a random name (file.filename), which is the public URL id. */
const reportPhotosMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 5 },
  fileFilter: (req, file, cb) =>
    IMAGES[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Only JPG, PNG or WebP images are allowed.'), { status: 400 }))
}).array('photos', 5);
const reportPhotos = (req, res, next) => reportPhotosMulter(req, res, err => {
  if (err) return next(err);
  (req.files || []).forEach(f => { f.filename = crypto.randomUUID() + IMAGES[f.mimetype]; });
  next();
});

/* The MIME type comes from the browser, so also check the file's first bytes. */
const SIGNATURES = [
  { ext: '.jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: '.pdf', test: b => b.subarray(0, 5).toString('latin1') === '%PDF-' }
];

/* Returns true if every uploaded file's content matches its extension. */
async function checkFiles(files = []) {
  for (const f of files) {
    const sig = SIGNATURES.find(s => s.ext === path.extname(f.filename).toLowerCase());
    if (f.buffer) {   // kept in memory (report photos)
      if (!sig || !sig.test(f.buffer.subarray(0, 12))) return false;
      continue;
    }
    const fh = await fs.open(f.path, 'r');
    try {
      const buf = Buffer.alloc(12);
      await fh.read(buf, 0, 12, 0);
      if (!sig || !sig.test(buf)) return false;
    } finally { await fh.close(); }
  }
  return true;
}

/* Delete uploaded files (best effort). Safe to call with undefined. */
const discardFiles = (files = []) => Promise.all(files.filter(f => f.path).map(f => fs.unlink(f.path).catch(() => {})));   // in-memory files need no cleanup

module.exports = {
  reportPhotos,   // POST /api/reports (saved in the database, see above)
  avatar: make('avatars', IMAGES, 'Only JPG, PNG or WebP images are allowed.').single('picture'),   // POST /api/users/me/picture
  proofFiles: make('proofs', IMAGES_AND_PDF, 'Only JPG, PNG, WebP or PDF files are allowed.').array('proofs', 3),   // POST /api/claims/:id/proofs
  checkFiles, discardFiles, UPLOAD_ROOT
};