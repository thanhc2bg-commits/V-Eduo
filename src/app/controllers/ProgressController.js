const Course = require('../models/Course');
const Module = require('../models/Module');
const Video = require('../models/Video');
const Enrollment = require('../models/Enrollment');
const Activity = require('../models/Activity');
const { getTotalVideosForCourse } = require('../../utils/progress');
const { issueCertificate } = require('../../utils/certificate');

class ProgressController {
    // [POST] /api/videos/:videoId/complete
    // Đánh dấu hoàn thành video — atomic + idempotent ($addToSet).
    // Tách 2 nhánh (bản 2.1): chưa enroll + không phải owner → 403;
    // chưa enroll + là owner → upsert tạo enrollment (auto-enroll owner).
    async completeVideo(req, res, next) {
        try {
            const video = await Video.findById(req.params.videoId);
            if (!video)
                return res.status(404).json({ error: 'Video không tồn tại' });

            // 1. Lấy Course cha từ Module — KHÔNG nhận courseId từ client
            const module = await Module.findById(video.moduleId);
            if (!module)
                return res.status(404).json({ error: 'Module không tồn tại' });
            const course = await Course.findById(module.courseId);
            if (!course)
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });

            // 2. Kiểm tra enrollment — bắt buộc
            let enrollment = await Enrollment.findOne({
                userId: req.user.id,
                courseId: module.courseId,
            });

            const isOwner =
                course.createdBy && course.createdBy.equals(req.user.id);

            // 2a. Nhánh 1: CHƯA enroll + KHÔNG phải owner → 403, KHÔNG upsert
            if (!enrollment && !isOwner) {
                return res
                    .status(403)
                    .json({ error: 'Bạn chưa đăng ký khóa học này' });
            }

            // 2b. Nhánh 2: CHƯA enroll + LÀ owner → upsert tạo enrollment (auto-enroll owner)
            if (!enrollment && isOwner) {
                enrollment = await Enrollment.findOneAndUpdate(
                    { userId: req.user.id, courseId: module.courseId },
                    {
                        $setOnInsert: {
                            status: 'active',
                            completedVideoIds: [],
                        },
                    },
                    { new: true, upsert: true, setDefaultsOnInsert: true },
                );
            }

            // 3. Atomic thật sự + idempotent: dùng điều kiện $ne ngay trong FILTER update —
            //    chỉ match (và chỉ update) nếu video CHƯA có trong mảng tại thời điểm update
            //    chạy. KHÔNG so sánh 2 thời điểm (beforeCount vs after) vì 2 request đồng thời
            //    có thể cùng đọc beforeCount trước khi update → cả 2 đều tính isNewlyCompleted
            //    = true dù chỉ 1 request thực sự thêm video → ghi trùng activity log.
            const newlyAdded = await Enrollment.findOneAndUpdate(
                { _id: enrollment._id, completedVideoIds: { $ne: video._id } },
                { $addToSet: { completedVideoIds: video._id } },
                { new: true },
            );
            const isNewlyCompleted = !!newlyAdded;

            // Nếu không match (video đã có sẵn từ trước, hoặc request khác vừa thêm) →
            // lấy lại state hiện tại để tính progressPercent/courseCompleted cho đúng.
            const updated =
                newlyAdded || (await Enrollment.findById(enrollment._id));

            // 4. Tính tiến độ — guard chia 0 (bản 2.2)
            const totalVideos = await getTotalVideosForCourse(module.courseId);
            const completedCount = updated.completedVideoIds.length;
            const progressPercent =
                totalVideos > 0
                    ? Math.round((completedCount / totalVideos) * 100)
                    : 0;

            let courseCompleted = false;
            if (completedCount >= totalVideos && totalVideos > 0) {
                // Atomic: chỉ set completed khi chưa completed (tránh ghi đè completedAt)
                const completed = await Enrollment.findOneAndUpdate(
                    { _id: updated._id, status: { $ne: 'completed' } },
                    { $set: { status: 'completed', completedAt: new Date() } },
                    { new: true },
                );
                courseCompleted = !!completed;

                // 5. Nếu hoàn thành → PHÁT CHỨNG CHỈ (Phase 4)
                //    🔒 Opt-in: CHỈ phát chứng chỉ nếu course đã bật `certificate: true`
                //    (kế hoạch mục 6.1). Course mặc định false → không phát ngoài ý muốn.
                //    issueCertificate() idempotent — chỉ phát 1 lần, race-safe (unique index + catch 11000).
                //    Lỗi phát certificate KHÔNG hủy mark completed (enrollment đã set completed rồi).
                if (courseCompleted) {
                    if (course.certificate === true) {
                        try {
                            await issueCertificate(
                                req.user.id,
                                module.courseId,
                            );
                        } catch (certErr) {
                            console.error(
                                'Lỗi phát chứng chỉ (bỏ qua, không ảnh hưởng response):',
                                certErr.message,
                            );
                        }
                    }

                    // Ghi activity course_completed — lỗi ghi activity không hủy gì.
                    // Ghi BẤT KỂ course có bật chứng chỉ hay không — hoàn thành khóa học
                    // vẫn là 1 sự kiện đáng ghi nhận, độc lập với việc có chứng chỉ.
                    try {
                        await Activity.create({
                            userId: req.user.id,
                            type: 'course_completed',
                            courseId: module.courseId,
                            metadata: { courseName: course.name },
                        });
                    } catch (activityErr) {
                        console.error(
                            'Lỗi ghi activity (bỏ qua, không ảnh hưởng response):',
                            activityErr.message,
                        );
                    }
                }
            }

            // 6. Ghi activity video_completed — CHỈ khi isNewlyCompleted === true
            //    (bản 2.2 — tránh phình activity log khi gọi lại API cho video đã hoàn thành).
            //    Lỗi ghi activity KHÔNG hủy mark completed.
            if (isNewlyCompleted) {
                try {
                    await Activity.create({
                        userId: req.user.id,
                        type: 'video_completed',
                        videoId: video._id,
                        courseId: module.courseId,
                        metadata: { title: video.title },
                    });
                } catch (activityErr) {
                    console.error(
                        'Lỗi ghi activity (bỏ qua, không ảnh hưởng response):',
                        activityErr.message,
                    );
                }
            }

            res.json({
                completed: true,
                progressPercent,
                courseCompleted,
            });
        } catch (err) {
            next(err);
        }
    }

    // [DELETE] /api/videos/:videoId/complete
    // Bỏ đánh dấu hoàn thành — atomic ($pull) + revert status về active.
    // Chứng chỉ đã cấp GIỮ NGUYÊN (snapshot, không thu hồi — rule bản 2.1).
    async uncompleteVideo(req, res, next) {
        try {
            const video = await Video.findById(req.params.videoId);
            if (!video)
                return res.status(404).json({ error: 'Video không tồn tại' });
            const module = await Module.findById(video.moduleId);
            if (!module)
                return res.status(404).json({ error: 'Module không tồn tại' });

            // Atomic: $pull videoId + revert status về active (nếu đang completed)
            const updated = await Enrollment.findOneAndUpdate(
                { userId: req.user.id, courseId: module.courseId },
                {
                    $pull: { completedVideoIds: video._id },
                    $set: { status: 'active', completedAt: null },
                },
                { new: true },
            );

            if (!updated) {
                return res
                    .status(404)
                    .json({ error: 'Không tìm thấy enrollment' });
            }

            // Guard chia 0 (bản 2.2)
            const totalVideos = await getTotalVideosForCourse(module.courseId);
            const progressPercent =
                totalVideos > 0
                    ? Math.round(
                          (updated.completedVideoIds.length / totalVideos) *
                              100,
                      )
                    : 0;

            res.json({
                completed: false,
                progressPercent,
            });
        } catch (err) {
            next(err);
        }
    }

    // [GET] /api/courses/:courseId/progress
    // Lấy tiến độ chi tiết của user trong khóa học — chỉ user đã enroll.
    async getProgress(req, res, next) {
        try {
            const courseId = req.params.courseId;
            if (!require('mongoose').isValidObjectId(courseId)) {
                return res
                    .status(400)
                    .json({ error: 'Course ID không hợp lệ' });
            }

            // Check course tồn tại (Vấn đề D mục 9.2)
            const course = await Course.findById(courseId);
            if (!course) {
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });
            }

            const enrollment = await Enrollment.findOne({
                userId: req.user.id,
                courseId,
            });
            if (!enrollment) {
                return res
                    .status(403)
                    .json({ error: 'Bạn chưa đăng ký khóa học này' });
            }

            const totalVideos = await getTotalVideosForCourse(courseId);
            const completedCount = enrollment.completedVideoIds.length;
            const progressPercent =
                totalVideos > 0
                    ? Math.round((completedCount / totalVideos) * 100)
                    : 0;

            res.json({
                courseId,
                totalVideos,
                completedCount,
                progressPercent,
                status: enrollment.status,
                completedVideoIds: enrollment.completedVideoIds.map(String),
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ProgressController();
