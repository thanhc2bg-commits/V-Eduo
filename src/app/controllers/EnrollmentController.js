const mongoose = require('mongoose');
const Course = require('../models/Course');
const Roadmap = require('../models/Roadmap');
const Enrollment = require('../models/Enrollment');
const Activity = require('../models/Activity');
const Module = require('../models/Module');
const Video = require('../models/Video');
const { mongooseToObject } = require('../../utils/mongoose');

const DAY_MS = 24 * 60 * 60 * 1000;

class EnrollmentController {
    // [POST] /api/courses/:courseId/enroll
    // Tham gia khóa học — ai cũng enroll được với course public;
    // course private / roadmap private chỉ owner mới enroll được.
    async enroll(req, res, next) {
        try {
            // 1. Validate + check course tồn tại
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

            // 2. Check quyền enroll theo course.isPublic + roadmap.visibility (kế hoạch bản 2.2)
            const isOwner =
                course.createdBy && course.createdBy.equals(req.user.id);

            let roadmapRestricts = false;
            if (course.roadmapId) {
                const roadmap = await Roadmap.findById(course.roadmapId);
                if (
                    roadmap &&
                    roadmap.visibility &&
                    roadmap.visibility !== 'public'
                ) {
                    roadmapRestricts = true;
                }
            }

            if ((!course.isPublic || roadmapRestricts) && !isOwner) {
                return res
                    .status(403)
                    .json({ error: 'Bạn không có quyền đăng ký khóa học này' });
            }

            // 3. Upsert enrollment — atomic + idempotent (setDefaultsOnInsert bắt buộc)
            const enrollment = await Enrollment.findOneAndUpdate(
                { userId: req.user.id, courseId: courseObjectId },
                { $setOnInsert: { status: 'active', completedVideoIds: [] } },
                { new: true, upsert: true, setDefaultsOnInsert: true },
            );

            // 4. Ghi activity 'course_enrolled' — lỗi ghi activity không hủy enroll
            try {
                await Activity.create({
                    userId: req.user.id,
                    type: 'course_enrolled',
                    courseId: courseObjectId,
                    metadata: { courseName: course.name },
                });
            } catch (activityErr) {
                console.error(
                    'Lỗi ghi activity (bỏ qua, không ảnh hưởng response):',
                    activityErr.message,
                );
            }

            res.status(201).json({ enrollment: mongooseToObject(enrollment) });
        } catch (err) {
            next(err);
        }
    }

    // [POST] /api/videos/:videoId/watch
    // Ghi nhận video bắt đầu xem — client gọi 1 lần khi video load.
    // Course public → cho ghi (xem thử); course private → chỉ owner hoặc enrolled.
    async recordWatch(req, res, next) {
        try {
            const video = await Video.findById(req.params.videoId);
            if (!video)
                return res.status(404).json({ error: 'Video không tồn tại' });

            const module = await Module.findById(video.moduleId);
            if (!module)
                return res.status(404).json({ error: 'Module không tồn tại' });

            const course = await Course.findById(module.courseId);
            if (!course)
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });

            // Course private/draft → chỉ owner hoặc enrolled mới ghi được
            if (!course.isPublic) {
                const isOwner =
                    course.createdBy && course.createdBy.equals(req.user.id);
                const isEnrolled = await Enrollment.exists({
                    userId: req.user.id,
                    courseId: module.courseId,
                });
                if (!isOwner && !isEnrolled) {
                    return res
                        .status(403)
                        .json({ error: 'Bạn không có quyền xem khóa học này' });
                }
            }

            await Activity.create({
                userId: req.user.id,
                type: 'video_started',
                videoId: video._id,
                courseId: module.courseId,
                metadata: {
                    title: video.title,
                    youtubeId: video.youtubeId,
                    courseName: course.name,
                    moduleName: module.name,
                },
            });

            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    }

    // [GET] /me/watch-history — trang HTML lịch sử xem, group theo ngày
    async watchHistory(req, res, next) {
        try {
            const page = parseInt(req.query.page, 10) || 1;
            const limit = 20;
            const skip = (page - 1) * limit;

            const activities = await Activity.find({
                userId: req.user.id,
                type: 'video_started',
            })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit + 1) // lấy thêm 1 để biết hasMore
                .lean();

            const hasMore = activities.length > limit;
            const pageItems = activities.slice(0, limit);

            const courseIds = [
                ...new Set(
                    pageItems
                        .map((item) => item.courseId && item.courseId.toString())
                        .filter(Boolean),
                ),
            ];
            const courses = await Course.find({ _id: { $in: courseIds } })
                .select('slug')
                .lean();
            const courseSlugMap = new Map(
                courses.map((course) => [
                    course._id.toString(),
                    course.slug,
                ]),
            );

            // Group theo ngày: Hôm nay / Hôm qua / Ngày cụ thể
            const grouped = [];
            const now = new Date();
            const todayStart = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate(),
            ).getTime();
            const yesterdayStart = todayStart - DAY_MS;

            let currentLabel = null;
            let currentItems = null;

            for (const item of pageItems) {
                const createdAt = new Date(item.createdAt).getTime();
                let label;
                if (createdAt >= todayStart) label = 'Hôm nay';
                else if (createdAt >= yesterdayStart) label = 'Hôm qua';
                else {
                    const d = new Date(createdAt);
                    label = `${String(d.getDate()).padStart(2, '0')}/${String(
                        d.getMonth() + 1,
                    ).padStart(2, '0')}/${d.getFullYear()}`;
                }

                if (label !== currentLabel) {
                    currentLabel = label;
                    currentItems = [];
                    grouped.push({ label, items: currentItems });
                }
                currentItems.push({
                    title: (item.metadata && item.metadata.title) || 'Video',
                    courseName:
                        (item.metadata && item.metadata.courseName) || '',
                    videoId: item.videoId ? item.videoId.toString() : null,
                    courseSlug: item.courseId
                        ? courseSlugMap.get(item.courseId.toString())
                        : null,
                    createdAt: item.createdAt,
                });
            }

            res.render('me/watch-history', {
                title: 'Lịch sử xem',
                grouped,
                pagination: { page, hasMore },
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new EnrollmentController();
