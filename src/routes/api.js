const express = require('express');
const router = express.Router();

const EnrollmentController = require('../app/controllers/EnrollmentController');
const ProgressController = require('../app/controllers/ProgressController');
const NoteController = require('../app/controllers/NoteController');
const ReviewController = require('../app/controllers/ReviewController');
const { requireAuth } = require('../app/middlewares/auth');
const {
    watchLimiter,
    progressLimiter,
    noteLimiter,
    reviewLimiter,
} = require('../app/middlewares/rateLimit');

// Enroll khóa học — cần đăng nhập
router.post(
    '/courses/:courseId/enroll',
    requireAuth,
    EnrollmentController.enroll,
);

// Ghi nhận video bắt đầu xem — cần đăng nhập + rate limit theo userId
router.post(
    '/videos/:videoId/watch',
    requireAuth,
    watchLimiter,
    EnrollmentController.recordWatch,
);

// --- Progress (Phase 2) ---
// Đánh dấu hoàn thành video — atomic + idempotent + rate limit theo userId
router.post(
    '/videos/:videoId/complete',
    requireAuth,
    progressLimiter,
    ProgressController.completeVideo,
);

// Bỏ đánh dấu hoàn thành video — atomic + revert status + rate limit theo userId
router.delete(
    '/videos/:videoId/complete',
    requireAuth,
    progressLimiter,
    ProgressController.uncompleteVideo,
);

// Lấy tiến độ chi tiết của user trong khóa học
router.get(
    '/courses/:courseId/progress',
    requireAuth,
    ProgressController.getProgress,
);

// --- Notes (Phase 2) ---
// Tạo ghi chú cho video — rate limit theo userId
router.post(
    '/videos/:videoId/notes',
    requireAuth,
    noteLimiter,
    NoteController.store,
);

// Danh sách ghi chú của tôi theo video
router.get('/videos/:videoId/notes', requireAuth, NoteController.index);

// Sửa ghi chú — filter { _id, userId } trong CÙNG 1 lệnh (chống IDOR)
router.put('/notes/:id', requireAuth, NoteController.update);

// Xóa ghi chú — filter { _id, userId } trong CÙNG 1 lệnh (chống IDOR)
router.delete('/notes/:id', requireAuth, NoteController.destroy);

// --- Reviews (Phase 3) ---
// Tạo/cập nhật đánh giá — upsert + rate limit theo userId
router.post(
    '/courses/:courseId/reviews',
    requireAuth,
    reviewLimiter,
    ReviewController.store,
);

// Danh sách review — public, không cần auth
router.get('/courses/:courseId/reviews', ReviewController.index);

// Rating trung bình + số lượt — public, không cần auth
router.get('/courses/:courseId/rating', ReviewController.getRating);

module.exports = router;
