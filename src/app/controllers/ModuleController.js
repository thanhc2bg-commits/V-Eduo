const Module = require('../models/Module');
const Course = require('../models/Course');
const { mongooseToObject } = require('../../utils/mongoose');

class ModuleController {
    //[POST] /courses/:courseId/modules
    // Tạo module mới trong Course — requireAuth + kiểm tra Course tồn tại và thuộc user
    async store(req, res, next) {
        try {
            const { name } = req.body;
            if (!name || !String(name).trim()) {
                return res
                    .status(400)
                    .json({ error: 'Tên module không được để trống' });
            }

            // Kiểm tra Course tồn tại
            const course = await Course.findById(req.params.courseId);
            if (!course) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy khóa học',
                });
            }

            // Kiểm tra quyền sở hữu Course (hoặc admin)
            const isOwner =
                course.createdBy &&
                req.user &&
                course.createdBy.equals(req.user.id);
            const isAdmin = req.user && req.user.role === 'admin';

            if (!isOwner && !isAdmin) {
                // Giữ pattern response như checkOwnership
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

            // Tính order = max(order hiện có của course) + 1
            const lastModule = await Module.findOne({
                courseId: course._id,
            }).sort({ order: -1 });
            const nextOrder = lastModule ? lastModule.order + 1 : 0;

            const module = new Module({
                name: String(name).trim(),
                courseId: course._id,
                order: nextOrder,
            });
            await module.save();
            res.status(201).json({ module: mongooseToObject(module) });
        } catch (err) {
            next(err);
        }
    }

    //[PUT] /modules/:id
    // requireAuth + checkCourseOwnership — req.resource là Module
    async update(req, res, next) {
        try {
            const module = req.resource;
            const { name } = req.body;

            if (name !== undefined) {
                if (!String(name).trim()) {
                    return res
                        .status(400)
                        .json({ error: 'Tên module không được để trống' });
                }
                module.name = String(name).trim();
            }

            await module.save();
            res.json({ module: mongooseToObject(module) });
        } catch (err) {
            next(err);
        }
    }

    //[DELETE] /modules/:id
    // requireAuth + checkCourseOwnership — xóa cứng Module (không soft-delete, theo thiết kế)
    async destroy(req, res, next) {
        try {
            await Module.deleteOne({ _id: req.params.id });
            // Xóa các Video thuộc Module (cascade xóa cứng)
            const Video = require('../models/Video');
            await Video.deleteMany({ moduleId: req.params.id });
            res.json({ message: 'Đã xóa module' });
        } catch (err) {
            next(err);
        }
    }

    //[PATCH] /modules/:id/reorder
    // requireAuth + checkCourseOwnership — nhận body { direction: 'up'|'down' }
    // Hoán đổi order với module liền kề CÙNG courseId
    async reorder(req, res, next) {
        try {
            const module = req.resource;
            const { direction } = req.body;

            if (direction !== 'up' && direction !== 'down') {
                return res.status(400).json({
                    error: "direction phải là 'up' hoặc 'down'",
                });
            }

            // Tìm module liền kề cùng courseId
            let neighbor;
            if (direction === 'up') {
                // Module có order nhỏ hơn, lớn nhất trong số nhỏ hơn
                neighbor = await Module.findOne({
                    courseId: module.courseId,
                    order: { $lt: module.order },
                }).sort({ order: -1 });
            } else {
                // Module có order lớn hơn, nhỏ nhất trong số lớn hơn
                neighbor = await Module.findOne({
                    courseId: module.courseId,
                    order: { $gt: module.order },
                }).sort({ order: 1 });
            }

            if (!neighbor) {
                return res
                    .status(400)
                    .json({ error: 'Không thể di chuyển — đã ở vị trí biên' });
            }

            // Hoán đổi order
            const temp = module.order;
            module.order = neighbor.order;
            neighbor.order = temp;

            await module.save();
            await neighbor.save();

            // Trả về danh sách modules của course để client render lại
            const modules = await Module.find({
                courseId: module.courseId,
            }).sort({ order: 1 });
            res.json({ modules });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ModuleController();
