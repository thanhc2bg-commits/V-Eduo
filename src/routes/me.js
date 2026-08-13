const express = require('express');
const router = express.Router();

const meController = require('../app/controllers/MeController');

router.get('/courses/stored', meController.storedCourses);
router.get('/courses/trash', meController.trashCourses);

module.exports = router;
