const express = require('express');
const ctrl = require('../controllers/usersController');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/me', ctrl.getMe);
router.put('/me', ctrl.updateMe);   // { full_name?, phone? }
router.post('/me/picture', upload.avatar, ctrl.setPicture);   // multipart, field "picture"
router.delete('/me/picture', ctrl.removePicture);

module.exports = router;
