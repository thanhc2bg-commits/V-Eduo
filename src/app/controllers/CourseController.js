const Course = require('../models/Course');
const { mongooseToObject } = require('../../utils/mongoose');

class CourseController {
    //[GET] /courses/:slug
    show(req, res, next) {
        Course.findOne({ slug: req.params.slug })
            .then((course) =>
                res.render('courses/show', {
                    course: mongooseToObject(course),
                }),
            )
            .catch(next);
    }

    //[GET] /courses/create
    create(req, res, next) {
        res.render('courses/create');
    }

    //[POST] /courses/store
    store(req, res, next) {
        const formData = req.body;
        formData.image = `https://img.youtube.com/vi/${formData.videoid}/sddefault.jpg`;
        const course = new Course(formData);

        course
            .save()
            .then(() => res.redirect('/courses/create'))
            .catch((err) => {
                if (err.code === 11000) {
                    return res
                        .status(409)
                        .send('Trùng dữ liệu, vui lòng thử lại');
                }
                next(err);
            });
    }

    //[GET] /courses/:id/edit
    edit(req, res, next) {
        Course.findById(req.params.id)
            .then((course) =>
                res.render('courses/edit', {
                    course: mongooseToObject(course),
                }),
            )
            .catch(next);
    }

    //[PUT] /courses/:id
    update(req, res, next) {
        const formData = req.body;
        formData.image = `https://img.youtube.com/vi/${formData.videoid}/sddefault.jpg`;

        Course.updateOne({ _id: req.params.id }, formData, {
            runValidators: true,
        })
            .then(() => res.redirect('/me/courses/stored'))
            .catch((err) => {
                if (err.code === 11000) {
                    return res
                        .status(409)
                        .send('Trùng dữ liệu, vui lòng thử lại');
                }
                next(err);
            });
    }

    //[DELETE] /courses/:id
    destroy(req, res, next) {
        Course.delete({ _id: req.params.id })
            .then(() => res.redirect('/me/courses/stored'))
            .catch(next);
    }

    //[PATCH] /courses/:id/restore
    restore(req, res, next) {
        Course.restore({ _id: req.params.id })
            .then(() => res.redirect('/me/courses/trash'))
            .catch(next);
    }

    //[DELETE] /courses/:id/force
    forceDestroy(req, res, next) {
        Course.deleteOne({ _id: req.params.id })
            .then(() => res.redirect('/me/courses/trash'))
            .catch(next);
    }
}

module.exports = new CourseController();
