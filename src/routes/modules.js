const express = require('express');
const router = express.Router();

const ModuleController = require('../app/controllers/ModuleController');
const VideoController = require('../app/controllers/VideoController');
const { requireAuth } = require('../app/middlewares/auth');
const {
    checkCourseOwnership,
} = require('../app/middlewares/checkCourseOwnership');
const Module = require('../app/models/Module');

// Route cần đăng nhập + kiểm tra quyền sở hữu qua Course cha
// - Module: Module.courseId → Course.createdBy
const checkModuleOwnership = checkCourseOwnership({
    resourceModel: Module,
    resolveCourseId: (module) => module.courseId,
});

// Tạo video mới trong Module — cần đăng nhập + kiểm tra quyền sở hữu (inline trong controller)
router.post('/:moduleId/videos', requireAuth, VideoController.store);

router.put('/:id', requireAuth, checkModuleOwnership, ModuleController.update);
router.delete(
    '/:id',
    requireAuth,
    checkModuleOwnership,
    ModuleController.destroy,
);
router.patch(
    '/:id/reorder',
    requireAuth,
    checkModuleOwnership,
    ModuleController.reorder,
);

module.exports = router;
