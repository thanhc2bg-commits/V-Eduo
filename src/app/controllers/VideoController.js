const Video = require('../models/Video');
const Module = require('../models/Module');
const Course = require('../models/Course');
const { mongooseToObject } = require('../../utils/mongoose');

class VideoController {
    //[POST] /modules/:moduleId/videos
    // Tạo video mới trong Module — requireAuth + kiểm tra Module tồn tại và Course cha thuộc user
    async store(req, res, next) {
        try {
            const { youtubeId, title, duration } = req.body;
            if (!youtubeId || !String(youtubeId).trim()) {
                return res
                    .status(400)
                    .json({ error: 'youtubeId không được để trống' });
            }
            if (!title || !String(title).trim()) {
                return res
                    .status(400)
                    .json({ error: 'Tiêu đề video không được để trống' });
            }

            // Kiểm tra Module tồn tại
            const module = await Module.findById(req.params.moduleId);
            if (!module) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy module',
                });
            }

            // Kiểm tra Course cha tồn tại
            const course = await Course.findById(module.courseId);
            if (!course) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy khóa học liên kết',
                });
            }

            // Kiểm tra quyền sở hữu Course (hoặc admin)
            const isOwner =
                course.createdBy &&
                req.user &&
                course.createdBy.equals(req.user.id);
            const isAdmin = req.user && req.user.role === 'admin';

            if (!isOwner && !isAdmin) {
                const wantsJson =
                    (req.headers.accept &&
                        req.headers.accept.includes('application/json')) ||
                    req.path.startsWith('/courses/playlist');
                if (wantsJson) {
                    return res
                        .status(403)
                        .json({ error: 'Không có quyền truy cập' });
                }
                return res.status(403).render('errors/403', {
                    layout: false,
                    error: 'Bạn không có quyền truy cập trang này',
                    user: req.user,
                });
            }

            // Tính order = max(order hiện có của module) + 1
            const lastVideo = await Video.findOne({
                moduleId: module._id,
            }).sort({ order: -1 });
            const nextOrder = lastVideo ? lastVideo.order + 1 : 0;

            const video = new Video({
                youtubeId: String(youtubeId).trim(),
                moduleId: module._id,
                title: String(title).trim(),
                order: nextOrder,
                duration: duration !== undefined ? duration : undefined,
            });
            await video.save();
            res.status(201).json({ video: mongooseToObject(video) });
        } catch (err) {
            next(err);
        }
    }

    //[PUT] /videos/:id
    // requireAuth + checkCourseOwnership — req.resource là Video
    async update(req, res, next) {
        try {
            const video = req.resource;
            const { youtubeId, title, duration } = req.body;

            if (youtubeId !== undefined) {
                if (!String(youtubeId).trim()) {
                    return res
                        .status(400)
                        .json({ error: 'youtubeId không được để trống' });
                }
                video.youtubeId = String(youtubeId).trim();
            }
            if (title !== undefined) {
                if (!String(title).trim()) {
                    return res
                        .status(400)
                        .json({ error: 'Tiêu đề video không được để trống' });
                }
                video.title = String(title).trim();
            }
            if (duration !== undefined) {
                video.duration = duration;
            }

            await video.save();
            res.json({ video: mongooseToObject(video) });
        } catch (err) {
            next(err);
        }
    }

    //[DELETE] /videos/:id
    // requireAuth + checkCourseOwnership — xóa cứng Video (không soft-delete, theo thiết kế)
    async destroy(req, res, next) {
        try {
            await Video.deleteOne({ _id: req.params.id });
            res.json({ message: 'Đã xóa video' });
        } catch (err) {
            next(err);
        }
    }

    //[PATCH] /videos/:id/reorder
    // requireAuth + checkCourseOwnership — nhận body { direction: 'up'|'down' }
    // Hoán đổi order với video liền kề CÙNG moduleId
    async reorder(req, res, next) {
        try {
            const video = req.resource;
            const { direction } = req.body;

            if (direction !== 'up' && direction !== 'down') {
                return res.status(400).json({
                    error: "direction phải là 'up' hoặc 'down'",
                });
            }

            // Tìm video liền kề cùng moduleId
            let neighbor;
            if (direction === 'up') {
                neighbor = await Video.findOne({
                    moduleId: video.moduleId,
                    order: { $lt: video.order },
                }).sort({ order: -1 });
            } else {
                neighbor = await Video.findOne({
                    moduleId: video.moduleId,
                    order: { $gt: video.order },
                }).sort({ order: 1 });
            }

            if (!neighbor) {
                return res
                    .status(400)
                    .json({ error: 'Không thể di chuyển — đã ở vị trí biên' });
            }

            // Hoán đổi order
            const temp = video.order;
            video.order = neighbor.order;
            neighbor.order = temp;

            await video.save();
            await neighbor.save();

            // Trả về danh sách videos của module để client render lại
            const videos = await Video.find({ moduleId: video.moduleId }).sort({
                order: 1,
            });
            res.json({ videos });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new VideoController();
