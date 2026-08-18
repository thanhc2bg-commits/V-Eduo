const Roadmap = require('../models/Roadmap');
const Course = require('../models/Course');
const {
    mongooseToObject,
    multipleMongooseToObject,
} = require('../../utils/mongoose');

class RoadmapController {
    //[GET] /roadmaps
    async index(req, res, next) {
        try {
            let query;
            if (req.user) {
                query = {
                    $or: [{ isPublic: true }, { createdBy: req.user.id }],
                };
            } else {
                query = { isPublic: true };
            }
            const roadmaps = await Roadmap.find(query).sort({ createdAt: -1 });
            res.render('roadmaps/index', {
                roadmaps: multipleMongooseToObject(roadmaps),
            });
        } catch (err) {
            next(err);
        }
    }

    //[GET] /roadmaps/create
    create(req, res) {
        res.render('roadmaps/create');
    }

    //[GET] /roadmaps/:slug
    async show(req, res, next) {
        try {
            const roadmap = await Roadmap.findOne({ slug: req.params.slug });
            if (!roadmap) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy lộ trình',
                });
            }

            const isOwner =
                req.user &&
                roadmap.createdBy &&
                roadmap.createdBy.equals(req.user.id);
            const isAdmin = req.user && req.user.role === 'admin';

            if (!roadmap.isPublic && !isOwner && !isAdmin) {
                return res.status(403).render('errors/403', {
                    layout: false,
                    error: 'Bạn không có quyền truy cập trang này',
                    user: req.user,
                });
            }

            const courses = await Course.find({ roadmapId: roadmap._id }).sort({
                createdAt: 1,
            });

            res.render('roadmaps/show', {
                roadmap: mongooseToObject(roadmap),
                courses: multipleMongooseToObject(courses),
                isOwner: !!isOwner,
                isAdmin: !!isAdmin,
            });
        } catch (err) {
            next(err);
        }
    }

    //[GET] /roadmaps/:id/edit
    // requireAuth + checkOwnership(Roadmap) — req.resource là Roadmap
    async edit(req, res, next) {
        try {
            const roadmap = req.resource;
            const myCourses = await Course.find({
                createdBy: req.user.id,
            }).sort({
                createdAt: -1,
            });
            const assignedIds = new Set(
                myCourses
                    .filter(
                        (c) => c.roadmapId && c.roadmapId.equals(roadmap._id),
                    )
                    .map((c) => c._id.toString()),
            );
            const coursesWithFlag = myCourses.map((c) => ({
                ...mongooseToObject(c),
                assigned: assignedIds.has(c._id.toString()),
            }));

            res.render('roadmaps/edit', {
                roadmap: mongooseToObject(roadmap),
                courses: coursesWithFlag,
            });
        } catch (err) {
            next(err);
        }
    }

    //[POST] /roadmaps
    async store(req, res, next) {
        try {
            const { name, description, isPublic } = req.body;
            if (!name || !String(name).trim()) {
                return res.status(400).send('Tên lộ trình không được để trống');
            }

            const roadmap = new Roadmap({
                name,
                description,
                isPublic:
                    isPublic !== undefined
                        ? isPublic === 'on' || isPublic === true
                        : true,
                createdBy: req.user.id,
            });
            await roadmap.save();
            res.redirect('/roadmaps/' + roadmap._id + '/edit');
        } catch (err) {
            next(err);
        }
    }

    //[PUT] /roadmaps/:id
    // requireAuth + checkOwnership(Roadmap)
    async update(req, res, next) {
        try {
            const roadmap = req.resource;
            const { name, description, isPublic } = req.body;

            if (name !== undefined) {
                if (!String(name).trim()) {
                    return res
                        .status(400)
                        .send('Tên lộ trình không được để trống');
                }
                roadmap.name = name;
            }
            if (description !== undefined) roadmap.description = description;
            if (isPublic !== undefined) {
                roadmap.isPublic = isPublic === 'on' || isPublic === true;
            }

            await roadmap.save();
            res.redirect('/roadmaps/' + roadmap._id + '/edit');
        } catch (err) {
            next(err);
        }
    }

    //[DELETE] /roadmaps/:id
    // requireAuth + checkOwnership(Roadmap)
    async destroy(req, res, next) {
        try {
            await Roadmap.delete({ _id: req.params.id });
            res.redirect('/me/roadmaps');
        } catch (err) {
            next(err);
        }
    }

    //[PUT] /roadmaps/:id/courses
    // requireAuth + checkOwnership(Roadmap) — gán/bỏ gán Course vào Roadmap.
    // Body: { courseIds: [...] } — danh sách Course MUỐN gán (đầy đủ, không phải delta).
    async assignCourses(req, res, next) {
        try {
            const roadmap = req.resource;
            const { courseIds } = req.body;
            if (!Array.isArray(courseIds)) {
                return res
                    .status(400)
                    .json({ error: 'courseIds phải là mảng' });
            }

            // Chỉ cho phép gán Course CỦA CHÍNH user này — không tin ID từ client
            // mà không đối chiếu quyền sở hữu.
            const myCourses = await Course.find({
                createdBy: req.user.id,
            }).select('_id roadmapId');
            const myCourseIds = new Set(myCourses.map((c) => c._id.toString()));

            const validRequestedIds = courseIds.filter((id) =>
                myCourseIds.has(id),
            );

            // Bỏ gán: Course của user này đang gán vào ĐÚNG Roadmap này nhưng
            // không còn trong danh sách mới → set roadmapId = null.
            const toUnassign = myCourses
                .filter(
                    (c) =>
                        c.roadmapId &&
                        c.roadmapId.equals(roadmap._id) &&
                        !validRequestedIds.includes(c._id.toString()),
                )
                .map((c) => c._id);

            if (toUnassign.length > 0) {
                await Course.updateMany(
                    { _id: { $in: toUnassign } },
                    { roadmapId: null },
                );
            }
            if (validRequestedIds.length > 0) {
                await Course.updateMany(
                    { _id: { $in: validRequestedIds }, createdBy: req.user.id },
                    { roadmapId: roadmap._id },
                );
            }

            const updatedCourses = await Course.find({
                roadmapId: roadmap._id,
            });
            res.json({
                courses: multipleMongooseToObject(updatedCourses),
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new RoadmapController();
