const Course = require('../models/Course');
const { multipleMongooseToObject } = require('../../utils/mongoose');

class SiteController {
    //[GET] /
    index(req, res, next) {
        Course.find({})
            .then((courses) => {
                res.render('home', {
                    title: 'Trang chủ',
                    courses: multipleMongooseToObject(courses),
                });
            })
            .catch(next);
    }

    //[GET] /search
    search(req, res) {
        res.render('search', {
            title: 'Tìm kiếm',
        });
    }
}

module.exports = new SiteController();
