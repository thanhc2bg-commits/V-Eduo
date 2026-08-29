const mongoose = require('mongoose');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const CourseReview = require('../models/CourseReview');
const Activity = require('../models/Activity');
const User = require('../models/User');
const {
    mongooseToObject,
    multipleMongooseToObject,
} = require('../../utils/mongoose');

async function canViewCourse(course, user) {
    if (course.isPublic !== false) return true;
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (course.createdBy && course.createdBy.equals(user.id)) return true;
    return Boolean(
        await Enrollment.exists({ userId: user.id, courseId: course._id }),
    );
}

class ReviewController {
    // [POST] /api/courses/:courseId/reviews
    // Tạo/cập nhật đánh giá — upsert (1 user chỉ 1 review/course).
    // Chỉ user đã enroll mới được đánh giá — chống review giả.
    async store(req, res, next) {
        try {
            const { rating, comment } = req.body;
            const ratingNum = Number(rating);

            // Validate
            if (
                !Number.isInteger(ratingNum) ||
                ratingNum < 1 ||
                ratingNum > 5
            ) {
                return res
                    .status(400)
                    .json({ error: 'Rating phải là số nguyên từ 1 đến 5' });
            }
            if (comment !== undefined && String(comment).length > 2000) {
                return res
                    .status(400)
                    .json({ error: 'Bình luận tối đa 2000 ký tự' });
            }

            // 🔒 Validate courseId trước khi cast (bản 2.0 — new + isValidObjectId)
            const courseId = req.params.courseId;
            if (!mongoose.isValidObjectId(courseId)) {
                return res
                    .status(400)
                    .json({ error: 'Course ID không hợp lệ' });
            }
            const courseObjectId = new mongoose.Types.ObjectId(courseId);

            // Check course tồn tại (Vấn đề E mục 9.2)
            const course = await Course.findById(courseObjectId);
            if (!course) {
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });
            }
            if (!(await canViewCourse(course, req.user))) {
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });
            }

            // Chỉ user đã enroll mới được đánh giá — chống review giả
            const enrollment = await Enrollment.findOne({
                userId: req.user.id,
                courseId: courseObjectId,
            });
            if (!enrollment) {
                return res
                    .status(403)
                    .json({ error: 'Bạn phải tham gia khóa học để đánh giá' });
            }

            // 🔧 Upsert phải có setDefaultsOnInsert: true + context: 'query' (bản 2.0)
            // - setDefaultsOnInsert: default field (comment: '') được set khi INSERT mới
            // - context: 'query': validator min/max hoạt động đúng trên upsert
            const review = await CourseReview.findOneAndUpdate(
                { userId: req.user.id, courseId: courseObjectId },
                { rating: ratingNum, comment: String(comment || '').trim() },
                {
                    new: true,
                    upsert: true,
                    runValidators: true,
                    setDefaultsOnInsert: true,
                    context: 'query',
                },
            );

            // Tính lại rating trung bình — dùng new + isValidObjectId (bản 2.0)
            const agg = await CourseReview.aggregate([
                { $match: { courseId: courseObjectId } },
                {
                    $group: {
                        _id: null,
                        avg: { $avg: '$rating' },
                        count: { $sum: 1 },
                    },
                },
            ]);

            // Ghi activity review_submitted — lỗi ghi activity không hủy review
            try {
                await Activity.create({
                    userId: req.user.id,
                    type: 'review_submitted',
                    courseId: courseObjectId,
                    metadata: { rating: ratingNum },
                });
            } catch (activityErr) {
                console.error(
                    'Lỗi ghi activity (bỏ qua, không ảnh hưởng response):',
                    activityErr.message,
                );
            }

            res.json({
                review: mongooseToObject(review),
                avgRating: agg[0]
                    ? Math.round(agg[0].avg * 10) / 10
                    : ratingNum,
                reviewCount: agg[0] ? agg[0].count : 1,
            });
        } catch (err) {
            next(err);
        }
    }

    // [GET] /api/courses/:courseId/reviews
    // Danh sách review — public, không cần auth.
    async index(req, res, next) {
        try {
            const courseId = req.params.courseId;
            if (!mongoose.isValidObjectId(courseId)) {
                return res
                    .status(400)
                    .json({ error: 'Course ID không hợp lệ' });
            }
            const courseObjectId = new mongoose.Types.ObjectId(courseId);

            const course = await Course.findById(courseObjectId);
            if (!course) {
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });
            }
            if (!(await canViewCourse(course, req.user))) {
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });
            }

            const reviews = await CourseReview.find({
                courseId: courseObjectId,
            })
                .sort({ createdAt: -1 })
                .limit(50)
                .lean();

            // Lấy tên user cho từng review — chỉ hiển thị name, không expose email
            const userIds = [
                ...new Set(reviews.map((r) => r.userId.toString())),
            ];
            const users = await User.find({ _id: { $in: userIds } })
                .select('name')
                .lean();
            const userMap = {};
            users.forEach((u) => {
                userMap[u._id.toString()] = u.name;
            });

            const reviewsWithUser = reviews.map((r) => ({
                ...r,
                userName: userMap[r.userId.toString()] || 'Người dùng',
            }));

            res.json({ reviews: reviewsWithUser });
        } catch (err) {
            next(err);
        }
    }

    // [GET] /api/courses/:courseId/rating
    // Rating trung bình + số lượt — public, không cần auth.
    async getRating(req, res, next) {
        try {
            const courseId = req.params.courseId;
            if (!mongoose.isValidObjectId(courseId)) {
                return res
                    .status(400)
                    .json({ error: 'Course ID không hợp lệ' });
            }
            const courseObjectId = new mongoose.Types.ObjectId(courseId);

            const course = await Course.findById(courseObjectId);
            if (!course) {
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });
            }
            if (!(await canViewCourse(course, req.user))) {
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });
            }

            const agg = await CourseReview.aggregate([
                { $match: { courseId: courseObjectId } },
                {
                    $group: {
                        _id: null,
                        avg: { $avg: '$rating' },
                        count: { $sum: 1 },
                    },
                },
            ]);

            res.json({
                avgRating: agg[0] ? Math.round(agg[0].avg * 10) / 10 : 0,
                reviewCount: agg[0] ? agg[0].count : 0,
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ReviewController();
