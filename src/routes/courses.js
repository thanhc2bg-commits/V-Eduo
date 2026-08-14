const express = require('express');
const router = express.Router();

const Controller = require('../app/controllers/CourseController');
const { requireAuth, requireRole } = require('../app/middlewares/auth');

// Các route quản trị — cần đăng nhập + role admin
const adminOnly = [requireAuth, requireRole('admin')];

router.get('/create', adminOnly, Controller.create);

router.post('/store', adminOnly, Controller.store);

router.get('/:id/edit', adminOnly, Controller.edit);

router.put('/:id', adminOnly, Controller.update);

router.patch('/:id/restore', adminOnly, Controller.restore);

router.delete('/:id', adminOnly, Controller.destroy);

router.delete('/:id/force', adminOnly, Controller.forceDestroy);

router.post('/playlist/items', adminOnly, Controller.fetchPlaylist);

router.post('/playlist/store', adminOnly, Controller.storePlaylist);

// Route công khai — không cần đăng nhập
router.get('/:slug', Controller.show);

module.exports = router;
