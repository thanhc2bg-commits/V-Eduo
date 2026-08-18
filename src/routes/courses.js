const express = require('express');
const router = express.Router();

const Controller = require('../app/controllers/CourseController');
const ModuleController = require('../app/controllers/ModuleController');
const { requireAuth, requireRole } = require('../app/middlewares/auth');
const { checkOwnership } = require('../app/middlewares/checkOwnership');
const { apiLimiter } = require('../app/middlewares/rateLimit');
const Course = require('../app/models/Course');

// Các route quản trị — cần đăng nhập + role admin
const adminOnly = [requireAuth, requireRole('admin')];

router.get('/create', requireAuth, Controller.create);

// Tạo Course — bất kỳ user đã login (UGC), không cần admin
router.post('/store', requireAuth, Controller.store);

// User sở hữu Course (hoặc admin) được xem form sửa
router.get('/:id/edit', requireAuth, checkOwnership(Course), Controller.edit);

// User sở hữu Course (hoặc admin) được quản lý cấu trúc Module/Video (Tree Builder)
router.get(
    '/:id/manage',
    requireAuth,
    checkOwnership(Course),
    Controller.manage,
);

// User sở hữu Course (hoặc admin) được cập nhật
router.put('/:id', requireAuth, checkOwnership(Course), Controller.update);

// Chỉ admin được khôi phục
router.patch('/:id/restore', adminOnly, Controller.restore);

// User sở hữu Course (hoặc admin) được xóa mềm
router.delete('/:id', requireAuth, checkOwnership(Course), Controller.destroy);

// Chỉ admin được xóa vĩnh viễn
router.delete('/:id/force', adminOnly, Controller.forceDestroy);

router.post(
    '/playlist/items',
    apiLimiter,
    requireAuth,
    Controller.fetchPlaylist,
);

router.post(
    '/playlist/store',
    apiLimiter,
    requireAuth,
    Controller.storePlaylist,
);

// Tạo module mới trong Course — cần đăng nhập + kiểm tra quyền sở hữu Course (inline trong controller)
router.post('/:courseId/modules', requireAuth, ModuleController.store);

// Bulk reorder Module — cần đăng nhập + kiểm tra quyền sở hữu Course (inline trong controller)
// Đặt TRƯỚC route GET /:slug (catch-all) để không bị nuốt
router.put(
    '/:courseId/modules/reorder',
    requireAuth,
    ModuleController.reorderBulk,
);

// Route công khai — không cần đăng nhập
router.get('/:slug', Controller.show);

module.exports = router;
