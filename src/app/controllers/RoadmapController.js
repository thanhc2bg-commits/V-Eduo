const Roadmap = require('../models/Roadmap');
const { mongooseToObject } = require('../../utils/mongoose');

class RoadmapController {
    //[GET] /roadmaps
    // Public roadmap ai cũng xem được; nếu có req.user thì trả thêm roadmap private của chính user đó
    async index(req, res, next) {
        try {
            let query;
            if (req.user) {
                // User đăng nhập: public + private của chính họ
                query = {
                    $or: [{ isPublic: true }, { createdBy: req.user.id }],
                };
            } else {
                // Khách: chỉ thấy public
                query = { isPublic: true };
            }
            const roadmaps = await Roadmap.find(query).sort({ createdAt: -1 });
            res.json({ roadmaps });
        } catch (err) {
            next(err);
        }
    }

    //[GET] /roadmaps/:slug
    // Public roadmap ai cũng xem được; private chỉ chủ sở hữu hoặc admin
    async show(req, res, next) {
        try {
            const roadmap = await Roadmap.findOne({ slug: req.params.slug });
            if (!roadmap) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy lộ trình',
                });
            }

            // Roadmap public → ai cũng xem được
            if (roadmap.isPublic) {
                return res.json({ roadmap: mongooseToObject(roadmap) });
            }

            // Roadmap private → chỉ chủ sở hữu hoặc admin
            const isOwner =
                req.user &&
                roadmap.createdBy &&
                roadmap.createdBy.equals(req.user.id);
            const isAdmin = req.user && req.user.role === 'admin';

            if (!isOwner && !isAdmin) {
                const wantsJson =
                    req.headers.accept &&
                    req.headers.accept.includes('application/json');
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

            res.json({ roadmap: mongooseToObject(roadmap) });
        } catch (err) {
            next(err);
        }
    }

    //[POST] /roadmaps
    // Bất kỳ user đã login — tự động set createdBy = req.user.id, không cho client truyền
    async store(req, res, next) {
        try {
            const { name, description, isPublic } = req.body;
            if (!name || !String(name).trim()) {
                return res
                    .status(400)
                    .json({ error: 'Tên lộ trình không được để trống' });
            }

            const roadmap = new Roadmap({
                name,
                description,
                isPublic: isPublic !== undefined ? isPublic : true,
                createdBy: req.user.id, // bảo mật: luôn lấy từ token, không tin client
            });
            await roadmap.save();
            res.status(201).json({ roadmap: mongooseToObject(roadmap) });
        } catch (err) {
            next(err);
        }
    }

    //[PUT] /roadmaps/:id
    // requireAuth + checkOwnership(Roadmap) — req.resource đã có document từ middleware
    async update(req, res, next) {
        try {
            const roadmap = req.resource;
            const { name, description, isPublic } = req.body;

            if (name !== undefined) {
                if (!String(name).trim()) {
                    return res
                        .status(400)
                        .json({ error: 'Tên lộ trình không được để trống' });
                }
                roadmap.name = name;
            }
            if (description !== undefined) {
                roadmap.description = description;
            }
            if (isPublic !== undefined) {
                roadmap.isPublic = isPublic;
            }

            await roadmap.save();
            res.json({ roadmap: mongooseToObject(roadmap) });
        } catch (err) {
            next(err);
        }
    }

    //[DELETE] /roadmaps/:id
    // requireAuth + checkOwnership(Roadmap) — soft delete
    async destroy(req, res, next) {
        try {
            await Roadmap.delete({ _id: req.params.id });
            res.json({ message: 'Đã xóa lộ trình' });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new RoadmapController();
