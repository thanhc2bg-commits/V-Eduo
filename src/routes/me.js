const express = require('express');
const router = express.Router();

const meController = require('../app/controllers/MeController');
const { requireAuth, requireRole } = require('../app/middlewares/auth');

// Khu vực quản trị — cần đăng nhập + role admin
const adminOnly = [requireAuth, requireRole('admin')];

router.get('/roadmaps', requireAuth, meController.myRoadmaps);
router.get('/courses', requireAuth, meController.myCourses);
router.get('/courses/stored', adminOnly, meController.storedCourses);
router.get('/courses/trash', adminOnly, meController.trashCourses);

module.exports = router;
