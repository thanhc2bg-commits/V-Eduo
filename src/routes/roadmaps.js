const express = require('express');
const router = express.Router();

const RoadmapController = require('../app/controllers/RoadmapController');
const { requireAuth } = require('../app/middlewares/auth');
const { checkOwnership } = require('../app/middlewares/checkOwnership');
const Roadmap = require('../app/models/Roadmap');

router.get('/create', requireAuth, RoadmapController.create);

router.post('/', requireAuth, RoadmapController.store);

router.get(
    '/:id/edit',
    requireAuth,
    checkOwnership(Roadmap),
    RoadmapController.edit,
);

router.put(
    '/:id/courses',
    requireAuth,
    checkOwnership(Roadmap),
    RoadmapController.assignCourses,
);

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

router.get('/', RoadmapController.index);

// Route công khai — PHẢI đặt CUỐI CÙNG (catch-all theo slug)
router.get('/:slug', RoadmapController.show);

module.exports = router;
