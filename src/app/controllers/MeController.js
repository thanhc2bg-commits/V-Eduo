const Course = require('../models/Course');
const Roadmap = require('../models/Roadmap');
const { multipleMongooseToObject } = require('../../utils/mongoose');

class MeController {
    myCourses(req, res, next) {
        Course.find({ createdBy: req.user.id })
            .then((courses) => {
                res.render('me/my-course', {
                    title: 'Khóa học của tôi',
                    courses: multipleMongooseToObject(courses),
                });
            })
            .catch(next);
    }
    storedCourses(req, res, next) {
        Promise.all([Course.find({}), Course.countDocumentsDeleted()])
            .then(([courses, deletedCount]) => {
                res.render('me/stored-course', {
                    title: 'Khóa học của tôi',
                    deletedCount,
                    courses: multipleMongooseToObject(courses),
                });
            })
            .catch(next);
    }
    trashCourses(req, res, next) {
        Course.findDeleted({})
            .then((courses) => {
                res.render('me/trash-course', {
                    title: 'Khóa học đã xóa',
                    courses: multipleMongooseToObject(courses),
                });
            })
            .catch(next);
    }
    myRoadmaps(req, res, next) {
        Roadmap.find({ createdBy: req.user.id })
            .then((roadmaps) => {
                res.render('me/my-roadmap', {
                    roadmaps: multipleMongooseToObject(roadmaps),
                });
            })
            .catch(next);
    }
}

module.exports = new MeController();
