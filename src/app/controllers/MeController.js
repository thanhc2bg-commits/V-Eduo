const Course = require('../models/Course');
const Roadmap = require('../models/Roadmap');
const Enrollment = require('../models/Enrollment');
const { multipleMongooseToObject } = require('../../utils/mongoose');
const { getTotalVideosForCourse } = require('../../utils/progress');

// Trạng thái hiển thị dựa trên visibility; fallback isPublic chỉ dành cho
// tài liệu cũ chưa có trường visibility (draft KHÔNG bị hiển thị thành "Riêng tư").
function getStatusMeta(roadmap) {
    const visibility = roadmap.visibility
        ? roadmap.visibility
        : roadmap.isPublic
          ? 'public'
          : 'private';
    switch (visibility) {
        case 'public':
            return {
                key: 'public',
                text: 'Công khai',
                cls: 'me-badge--success',
            };
        case 'draft':
            return { key: 'draft', text: 'Bản nháp', cls: 'me-badge--warning' };
        default:
            return {
                key: 'private',
                text: 'Riêng tư',
                cls: 'me-badge--neutral',
            };
    }
}

class MeController {
    myCourses(req, res, next) {
        Course.find({ createdBy: req.user.id })
            .then((courses) => {
                res.render('me/my-course', {
                    title: 'Khóa học tôi tạo',
                    courses: multipleMongooseToObject(courses),
                });
            })
            .catch(next);
    }

    async learning(req, res, next) {
        try {
            const enrollments = await Enrollment.find({ userId: req.user.id })
                .sort({ updatedAt: -1 })
                .populate('courseId')
                .lean();

            const learningCourses = await Promise.all(
                enrollments
                    .filter((enrollment) => enrollment.courseId)
                    .map(async (enrollment) => {
                        const course = enrollment.courseId;
                        const totalVideos = await getTotalVideosForCourse(
                            course._id,
                        );
                        const completedCount =
                            enrollment.completedVideoIds?.length || 0;
                        const progressPercent =
                            totalVideos > 0
                                ? Math.min(
                                      100,
                                      Math.round(
                                          (completedCount / totalVideos) * 100,
                                      ),
                                  )
                                : 0;

                        return {
                            course,
                            completedCount,
                            totalVideos,
                            progressPercent,
                            isCompleted: enrollment.status === 'completed',
                        };
                    }),
            );

            res.render('me/learning', {
                title: 'Khóa học đang học',
                learningCourses,
            });
        } catch (error) {
            next(error);
        }
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
                const list = multipleMongooseToObject(roadmaps).map(
                    (roadmap) => ({
                        ...roadmap,
                        status: getStatusMeta(roadmap),
                    }),
                );
                res.render('me/my-roadmap', {
                    title: 'Lộ trình tôi tạo',
                    roadmaps: list,
                });
            })
            .catch(next);
    }
}

module.exports = new MeController();
