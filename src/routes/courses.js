const express = require('express');
const router = express.Router();

const Controller = require('../app/controllers/CourseController');

router.get('/create', Controller.create);

router.post('/store', Controller.store);

router.get('/:id/edit', Controller.edit);

router.put('/:id', Controller.update);

router.patch('/:id/restore', Controller.restore);

router.delete('/:id', Controller.destroy);

router.delete('/:id/force', Controller.forceDestroy);

router.get('/:slug', Controller.show);

module.exports = router;
