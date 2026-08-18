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

    //[PUT] /courses/:courseId/modules/reorder
    // Nhận danh sách ID Module theo thứ tự MỚI sau khi kéo-thả, gán lại order = 0,1,2...
    // requireAuth — check quyền sở hữu Course qua :courseId trong URL (không qua checkCourseOwnership,
    // vì route này không có :id của 1 resource đơn lẻ mà thao tác cả danh sách)
    async reorderBulk(req, res, next) {
        try {
            const { orderedIds } = req.body;
            if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
                return res
                    .status(400)
                    .json({ error: 'orderedIds phải là mảng không rỗng' });
            }

            const course = await Course.findById(req.params.courseId);
            if (!course) {
                return res
                    .status(404)
                    .json({ error: 'Không tìm thấy khóa học' });
            }

            const isOwner =
                course.createdBy &&
                req.user &&
                course.createdBy.equals(req.user.id);
            const isAdmin = req.user && req.user.role === 'admin';
            if (!isOwner && !isAdmin) {
                return res
                    .status(403)
                    .json({ error: 'Không có quyền truy cập' });
            }

            // Lấy toàn bộ Module thật sự thuộc Course này để đối chiếu — KHÔNG tin
            // nguyên xi orderedIds từ client (có thể chứa ID của Course khác).
            const actualModules = await Module.find({
                courseId: course._id,
            }).select('_id');
            const actualIds = actualModules.map((m) => m._id.toString()).sort();
            const requestedIds = [...orderedIds].sort();

            if (
                actualIds.length !== requestedIds.length ||
                !actualIds.every((id, i) => id === requestedIds[i])
            ) {
                return res.status(400).json({
                    error: 'Danh sách ID không khớp với Module thực tế của khóa học này',
                });
            }

            // Bulk update order theo đúng vị trí trong orderedIds
            const bulkOps = orderedIds.map((id, index) => ({
                updateOne: {
                    filter: { _id: id, courseId: course._id },
                    update: { order: index },
                },
            }));
            await Module.bulkWrite(bulkOps);

            const modules = await Module.find({ courseId: course._id }).sort({
                order: 1,
            });
            res.json({ modules });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ModuleController();
