const express = require('express');
const router = express.Router();

const RoadmapController = require('../app/controllers/RoadmapController');
const { requireAuth } = require('../app/middlewares/auth');
const { checkOwnership } = require('../app/middlewares/checkOwnership');
const Roadmap = require('../app/models/Roadmap');

// Route công khai — không cần đăng nhập (attachUser chạy global để biết req.user nếu có)
router.get('/', RoadmapController.index);
router.get('/:slug', RoadmapController.show);

// Route cần đăng nhập — bất kỳ user nào (không cần role admin)
router.post('/', requireAuth, RoadmapController.store);

// Route cần đăng nhập + kiểm tra quyền sở hữu
router.put(
    '/:id',
    requireAuth,
    checkOwnership(Roadmap),
    RoadmapController.update,
);
router.delete(
    '/:id',
    requireAuth,
    checkOwnership(Roadmap),
    RoadmapController.destroy,
);

module.exports = router;
