const express = require('express');
const ctrl = require('../controllers/usersController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/me', ctrl.getMe);
router.put('/me', ctrl.updateMe);   // TODO
// /users/me/password from the plan is dropped: login is Google only.

module.exports = router;
