const express = require('express');
const router = express.Router();

const VideoController = require('../app/controllers/VideoController');
const { requireAuth } = require('../app/middlewares/auth');
const {
    checkCourseOwnership,
} = require('../app/middlewares/checkCourseOwnership');
const Video = require('../app/models/Video');
const Module = require('../app/models/Module');

// Route cần đăng nhập + kiểm tra quyền sở hữu qua chuỗi Video→Module→Course:
// - Video.moduleId → Module.courseId → Course.createdBy
const checkVideoOwnership = checkCourseOwnership({
    resourceModel: Video,
    resolveCourseId: async (video) => {
        const mod = await Module.findById(video.moduleId);
        return mod ? mod.courseId : null;
    },
});

router.put('/:id', requireAuth, checkVideoOwnership, VideoController.update);
router.delete(
    '/:id',
    requireAuth,
    checkVideoOwnership,
    VideoController.destroy,
);

module.exports = router;
