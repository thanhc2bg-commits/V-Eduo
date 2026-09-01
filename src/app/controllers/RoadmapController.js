const Roadmap = require('../models/Roadmap');
const Course = require('../models/Course');
const {
    mongooseToObject,
    multipleMongooseToObject,
} = require('../../utils/mongoose');

function normalizeVisibility(rawVisibility, rawIsPublic) {
    if (
        rawVisibility === 'public' ||
        rawVisibility === 'private' ||
        rawVisibility === 'draft'
    ) {
        return rawVisibility;
    }
    const isPublic = Array.isArray(rawIsPublic)
        ? rawIsPublic.includes('true')
        : rawIsPublic === 'true' || rawIsPublic === true;
    return isPublic ? 'public' : 'private';
}

function isRoadmapPublic(roadmap) {
    if (roadmap.visibility === 'public') return true;
    if (roadmap.visibility === 'private' || roadmap.visibility === 'draft')
        return false;
    return !!roadmap.isPublic;
}

// Chuẩn hóa chuỗi form: trim, undefined/null -> ''.
function toTrimmed(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

// Chỉ chấp nhận URL http/https hợp lệ hoặc chuỗi rỗng.
function isValidCoverImage(value) {
    const trimmed = toTrimmed(value);
    if (!trimmed) return true;
    try {
        const url = new URL(trimmed);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

// Giới hạn độ dài hợp lý, không phá dữ liệu cũ (align với maxLength model).
const LIMITS = {
    name: 255,
    description: 2000,
    category: 120,
    difficulty: 120,
    coverImage: 500,
};

// Validate + trim payload roadmap. Trả về { errors: {field: message}, values: {...} }.
function validateRoadmapPayload(body) {
    const name = toTrimmed(body.name);
    const description = toTrimmed(body.description);
    const category = toTrimmed(body.category);
    const difficulty = toTrimmed(body.difficulty);
    const coverImage = toTrimmed(body.coverImage);

    const errors = {};
    if (!name) errors.name = 'Tên lộ trình không được để trống';
    else if (name.length > LIMITS.name)
        errors.name = `Tên lộ trình không được dài quá ${LIMITS.name} ký tự`;

    if (description.length > LIMITS.description)
        errors.description = `Mô tả không được dài quá ${LIMITS.description} ký tự`;
    if (category.length > LIMITS.category)
        errors.category = `Danh mục không được dài quá ${LIMITS.category} ký tự`;
    if (difficulty.length > LIMITS.difficulty)
        errors.difficulty = `Độ khó không được dài quá ${LIMITS.difficulty} ký tự`;
    if (coverImage.length > LIMITS.coverImage)
        errors.coverImage = `Đường dẫn ảnh bìa không được dài quá ${LIMITS.coverImage} ký tự`;
    else if (coverImage && !isValidCoverImage(coverImage))
        errors.coverImage =
            'Đường dẫn ảnh bìa không hợp lệ (chỉ chấp nhận URL http:// hoặc https://)';

    return {
        errors,
        values: { name, description, category, difficulty, coverImage },
    };
}

// Trạng thái hiển thị dựa trên visibility, fallback isPublic cho dữ liệu cũ.
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

// Lấy danh sách khóa học thuộc chủ sở hữu roadmap, kèm cờ assigned.
async function getCoursesWithAssignFlag(roadmap) {
    const ownerId = roadmap.createdBy;
    const ownerCourses = await Course.find({ createdBy: ownerId }).sort({
        createdAt: -1,
    });
    const assignedIds = new Set(
        ownerCourses
            .filter((c) => c.roadmapId && c.roadmapId.equals(roadmap._id))
            .map((c) => c._id.toString()),
    );
    return ownerCourses.map((c) => ({
        ...mongooseToObject(c),
        assigned: assignedIds.has(c._id.toString()),
    }));
}

class RoadmapController {
    //[GET] /roadmaps — catalogue công khai.
    // Mọi đối tượng (đã đăng nhập hay chưa) đều chỉ thấy roadmap public.
    // Lộ trình riêng tư/bản nháp chỉ xuất hiện tại /me/roadmaps.
    async index(req, res, next) {
        try {
            const query = {
                $or: [
                    { visibility: 'public' },
                    {
                        $and: [
                            { visibility: { $exists: false } },
                            { isPublic: true },
                        ],
                    },
                ],
            };
            const roadmaps = await Roadmap.find(query).sort({ createdAt: -1 });

            // Đếm số khóa học công khai thuộc từng roadmap (chỉ khách thấy khóa public).
            const counts = await Course.aggregate([
                {
                    $match: {
                        roadmapId: { $ne: null },
                        isPublic: { $ne: false },
                    },
                },
                { $group: { _id: '$roadmapId', count: { $sum: 1 } } },
            ]);
            const countMap = {};
            counts.forEach((c) => {
                countMap[String(c._id)] = c.count;
            });

            const list = multipleMongooseToObject(roadmaps).map((roadmap) => ({
                ...roadmap,
                courseCount: countMap[String(roadmap._id)] || 0,
            }));

            res.render('roadmaps/index', {
                roadmaps: list,
            });
        } catch (err) {
            next(err);
        }
    }

    //[GET] /roadmaps/create
    create(req, res) {
        res.render('roadmaps/create', {
            errorMessage: null,
            fieldErrors: null,
            oldValues: null,
        });
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

            if (!isRoadmapPublic(roadmap) && !isOwner && !isAdmin) {
                return res.status(403).render('errors/403', {
                    layout: false,
                    error: 'Bạn không có quyền truy cập trang này',
                    user: req.user,
                });
            }

            const coursesQuery = { roadmapId: roadmap._id };
            // Người xem bình thường (không phải owner/admin) chỉ thấy khóa học công khai.
            if (!isOwner && !isAdmin) {
                coursesQuery.isPublic = { $ne: false };
            }
            const courses = await Course.find(coursesQuery).sort([
                ['roadmapOrder', 1],
                ['createdAt', 1],
            ]);

            res.render('roadmaps/show', {
                roadmap: mongooseToObject(roadmap),
                courses: multipleMongooseToObject(courses),
                status: getStatusMeta(roadmap),
                isOwner: !!isOwner,
                isAdmin: !!isAdmin,
                canManage: !!isOwner || !!isAdmin,
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
            const coursesWithFlag = await getCoursesWithAssignFlag(roadmap);

            res.render('roadmaps/edit', {
                roadmap: mongooseToObject(roadmap),
                courses: coursesWithFlag,
                status: getStatusMeta(roadmap),
                errorMessage: null,
                fieldErrors: null,
                oldValues: {
                    name: roadmap.name,
                    description: roadmap.description,
                    category: roadmap.category,
                    difficulty: roadmap.difficulty,
                    coverImage: roadmap.coverImage,
                    visibility:
                        roadmap.visibility ||
                        (roadmap.isPublic ? 'public' : 'private'),
                },
            });
        } catch (err) {
            next(err);
        }
    }

    //[POST] /roadmaps
    async store(req, res, next) {
        try {
            const { visibility, isPublic } = req.body;
            const { errors, values } = validateRoadmapPayload(req.body);
            const errorKeys = Object.keys(errors);
            if (errorKeys.length > 0) {
                // Render lại form với dữ liệu người dùng đã nhập + thông báo lỗi.
                return res.status(400).render('roadmaps/create', {
                    errorMessage: errors[errorKeys[0]],
                    fieldErrors: errors,
                    oldValues: {
                        ...values,
                        visibility,
                        isPublic,
                    },
                });
            }

            const normalizedVisibility = normalizeVisibility(
                visibility,
                isPublic,
            );

            const roadmap = new Roadmap({
                name: values.name,
                description: values.description,
                visibility: normalizedVisibility,
                isPublic: normalizedVisibility === 'public',
                category: values.category,
                difficulty: values.difficulty,
                coverImage: values.coverImage,
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
            const { visibility, isPublic } = req.body;
            const { errors, values } = validateRoadmapPayload(req.body);
            const errorKeys = Object.keys(errors);
            if (errorKeys.length > 0) {
                // Render lại form chỉnh sửa với dữ liệu đã nhập.
                const status = getStatusMeta({
                    ...roadmap.toObject(),
                    visibility:
                        visibility === 'public' ||
                        visibility === 'private' ||
                        visibility === 'draft'
                            ? visibility
                            : roadmap.visibility,
                });
                const coursesWithFlag = await getCoursesWithAssignFlag(roadmap);
                return res.status(400).render('roadmaps/edit', {
                    roadmap: {
                        ...mongooseToObject(roadmap),
                        ...values,
                    },
                    courses: coursesWithFlag,
                    status,
                    errorMessage: errors[errorKeys[0]],
                    fieldErrors: errors,
                    oldValues: {
                        ...values,
                        visibility,
                        isPublic,
                    },
                });
            }

            roadmap.name = values.name;
            roadmap.description = values.description;
            if (visibility !== undefined || isPublic !== undefined) {
                const normalizedVisibility = normalizeVisibility(
                    visibility,
                    isPublic,
                );
                roadmap.visibility = normalizedVisibility;
                roadmap.isPublic = normalizedVisibility === 'public';
            }
            roadmap.category = values.category;
            roadmap.difficulty = values.difficulty;
            roadmap.coverImage = values.coverImage;

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
            const roadmap = req.resource;
            // Xóa mềm roadmap: gỡ tham chiếu roadmapId ở các khóa học đang
            // được gán để tránh dữ liệu mồ côi trỏ vào roadmap đã xóa.
            await Course.updateMany(
                { roadmapId: roadmap._id },
                { roadmapId: null, roadmapOrder: null },
            );
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
            let { courseIds } = req.body;
            if (courseIds === undefined) courseIds = [];
            if (!Array.isArray(courseIds)) {
                return res
                    .status(400)
                    .json({ error: 'courseIds phải là mảng' });
            }

            // Lấy danh sách khóa học CỦA CHỦ SỞ HỮU roadmap (roadmap.createdBy).
            // - User tự quản lý roadmap của mình: đúng khóa học của họ.
            // - Admin quản lý roadmap của người khác: phải dùng createdBy của
            //   roadmap, KHÔNG phải course của tài khoản admin đang đăng nhập.
            // Không tin ID từ client mà không đối chiếu quyền sở hữu phía server.
            const ownerId = roadmap.createdBy;
            const ownerCourses = await Course.find({
                createdBy: ownerId,
            }).select('_id roadmapId');
            const ownerCourseIds = new Set(
                ownerCourses.map((c) => c._id.toString()),
            );

            const validRequestedIds = courseIds.filter((id) =>
                ownerCourseIds.has(id),
            );

            // Bỏ gán: Course của user này đang gán vào ĐÚNG Roadmap này nhưng
            // không còn trong danh sách mới → set roadmapId = null.
            const toUnassign = ownerCourses
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
                    { roadmapId: null, roadmapOrder: null },
                );
            }
            if (validRequestedIds.length > 0) {
                const bulkOps = validRequestedIds.map((id, index) => ({
                    updateOne: {
                        filter: { _id: id, createdBy: ownerId },
                        update: { roadmapId: roadmap._id, roadmapOrder: index },
                    },
                }));
                await Course.bulkWrite(bulkOps);
            }

            res.redirect('/roadmaps/' + roadmap._id + '/edit');
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new RoadmapController();
