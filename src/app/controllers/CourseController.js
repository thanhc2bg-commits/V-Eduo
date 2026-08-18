const Course = require('../models/Course');
const Module = require('../models/Module');
const Video = require('../models/Video');
const PlaylistCache = require('../models/PlaylistCache');
const { mongooseToObject } = require('../../utils/mongoose');
const {
    extractPlaylistId,
    fetchPlaylistVideos,
    MAX_VIDEOS_PER_BATCH,
} = require('../../utils/youtube');
const {
    validateCourse,
    validatePlaylistFetch,
} = require('../../utils/validators');

class CourseController {
    //[GET] /courses/:slug
    async show(req, res, next) {
        try {
            const course = await Course.findOne({ slug: req.params.slug });
            if (!course) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy khóa học',
                });
            }

            // Build cây Module → Video (nếu có). Dùng .lean() để trả thẳng plain
            // object, tránh Mongoose Document lẫn vào Handlebars.
            const modulesRaw = await Module.find({ courseId: course._id })
                .sort({ order: 1 })
                .lean();

            const modules = await Promise.all(
                modulesRaw.map(async (module) => {
                    const videos = await Video.find({ moduleId: module._id })
                        .sort({ order: 1 })
                        .lean();
                    return { ...module, videos };
                }),
            );

            // Xác định video hiển thị đầu tiên: ưu tiên Video đầu của Module đầu
            // (nếu có cây), fallback về course.videoid cũ (course chưa có Module/Video).
            let initialVideoId = course.videoid;
            if (modules.length > 0 && modules[0].videos.length > 0) {
                initialVideoId = modules[0].videos[0].youtubeId;
            }

            res.render('courses/show', {
                title: course.name,
                course: mongooseToObject(course),
                modules, // đã là plain object (từ .lean()), không cần mongooseToObject
                hasTree: modules.length > 0,
                initialVideoId,
            });
        } catch (err) {
            next(err);
        }
    }

    //[GET] /courses/create
    create(req, res, next) {
        res.render('courses/create', {
            title: 'Tạo khóa học',
            isAdmin: req.user.role === 'admin',
        });
    }

    //[POST] /courses/store
    // Bất kỳ user đã login — createdBy LUÔN lấy từ req.user.id, không tin client
    store(req, res, next) {
        const { ok, error } = validateCourse(req.body);
        if (!ok) {
            return res.status(400).send(error);
        }

        // Copy body nhưng LOẠI BỎ createdBy nếu client cố tình gửi lên
        const formData = { ...req.body };
        delete formData.createdBy;
        formData.image = `https://img.youtube.com/vi/${formData.videoid}/sddefault.jpg`;
        formData.createdBy = req.user.id; // bảo mật: luôn lấy từ token
        const course = new Course(formData);

        course
            .save()
            .then(() =>
                res.redirect(
                    (req.user.role === 'admin'
                        ? '/me/courses/stored'
                        : '/me/courses') + '?created=1',
                ),
            )
            .catch((err) => {
                if (err.code === 11000) {
                    return res
                        .status(409)
                        .send('Trùng dữ liệu, vui lòng thử lại');
                }
                next(err);
            });
    }

    //[GET] /courses/:id/edit
    edit(req, res, next) {
        Course.findById(req.params.id)
            .then((course) =>
                res.render('courses/edit', {
                    title: 'Chỉnh sửa khóa học',
                    course: mongooseToObject(course),
                }),
            )
            .catch(next);
    }

    //[GET] /courses/:id/manage
    // requireAuth + checkOwnership(Course) — req.resource là Course, chỉ owner/admin vào được
    async manage(req, res, next) {
        try {
            const course = req.resource;

            const modulesRaw = await Module.find({ courseId: course._id })
                .sort({ order: 1 })
                .lean();

            const modules = await Promise.all(
                modulesRaw.map(async (module) => {
                    const videos = await Video.find({ moduleId: module._id })
                        .sort({ order: 1 })
                        .lean();
                    return { ...module, videos };
                }),
            );

            res.render('courses/manage', {
                title: 'Quản lý cấu trúc',
                course: mongooseToObject(course),
                modules,
            });
        } catch (err) {
            next(err);
        }
    }

    //[PUT] /courses/:id
    update(req, res, next) {
        const { ok, error } = validateCourse(req.body, true);
        if (!ok) {
            return res.status(400).send(error);
        }

        const formData = req.body;
        formData.image = `https://img.youtube.com/vi/${formData.videoid}/sddefault.jpg`;

        Course.updateOne({ _id: req.params.id }, formData, {
            runValidators: true,
        })
            .then(() =>
                res.redirect(
                    (req.user.role === 'admin'
                        ? '/me/courses/stored'
                        : '/me/courses') + '?updated=1',
                ),
            )
            .catch((err) => {
                if (err.code === 11000) {
                    return res
                        .status(409)
                        .send('Trùng dữ liệu, vui lòng thử lại');
                }
                next(err);
            });
    }

    //[DELETE] /courses/:id
    destroy(req, res, next) {
        Course.delete({ _id: req.params.id })
            .then(() =>
                res.redirect(
                    req.user.role === 'admin'
                        ? '/me/courses/stored'
                        : '/me/courses',
                ),
            )
            .catch(next);
    }

    //[PATCH] /courses/:id/restore
    restore(req, res, next) {
        Course.restore({ _id: req.params.id })
            .then(() => res.redirect('/me/courses/trash?restored=1'))
            .catch(next);
    }

    //[DELETE] /courses/:id/force
    // Cascade xóa cứng: Course → Module → Video.
    // Thứ tự: Video (ref Module) phải xóa trước, rồi Module, cuối cùng Course.
    // Nếu bất kỳ bước nào lỗi → next(err), KHÔNG để xóa dở dang.
    async forceDestroy(req, res, next) {
        try {
            // 1. Tìm tất cả Module thuộc Course
            const modules = await Module.find({
                courseId: req.params.id,
            }).select('_id');
            const moduleIds = modules.map((m) => m._id);

            // 2. Xóa cứng tất cả Video thuộc các Module đó (nếu có)
            if (moduleIds.length > 0) {
                await Video.deleteMany({ moduleId: { $in: moduleIds } });
            }

            // 3. Xóa cứng tất cả Module đó (nếu có)
            await Module.deleteMany({ courseId: req.params.id });

            // 4. Cuối cùng mới xóa cứng Course
            await Course.deleteOne({ _id: req.params.id });

            res.redirect('/me/courses/trash?deleted=1');
        } catch (err) {
            next(err);
        }
    }

    //[POST] /courses/playlist/items
    // Lấy danh sách video từ playlist YouTube (gọi Data API v3)
    async fetchPlaylist(req, res, next) {
        try {
            const { ok, error } = validatePlaylistFetch(req.body);
            if (!ok) {
                return res.status(400).json({ error });
            }

            const playlistId = extractPlaylistId(req.body.playlist);
            if (!playlistId) {
                return res
                    .status(400)
                    .json({ error: 'Playlist ID không hợp lệ' });
            }

            // Kiểm tra cache trước — tránh gọi YouTube API thừa (tốn quota)
            // Check thêm điều kiện thời gian tường minh vì TTL index của MongoDB
            // có thể trễ tới ~60s so với mốc hết hạn thực tế.
            const cacheExpiry = new Date(Date.now() - 5 * 60 * 1000);
            const cached = await PlaylistCache.findOne({
                playlistId,
                fetchedAt: { $gt: cacheExpiry },
            });
            if (cached) {
                return res.json({ videos: cached.videos, fromCache: true });
            }

            const { videos } = await fetchPlaylistVideos(
                playlistId,
                process.env.YOUTUBE_API_KEY,
            );

            // Lưu/cập nhật cache (upsert). Cache chỉ là tối ưu phụ — nếu ghi lỗi
            // (ví dụ race condition duplicate key khi 2 request cùng playlistId
            // gần như đồng thời), KHÔNG được làm hỏng response chính, vì video
            // đã fetch thành công từ YouTube rồi.
            try {
                await PlaylistCache.findOneAndUpdate(
                    { playlistId },
                    { playlistId, videos, fetchedAt: new Date() },
                    { upsert: true },
                );
            } catch (cacheErr) {
                console.error(
                    'Lỗi ghi playlist cache (bỏ qua, không ảnh hưởng response):',
                    cacheErr.message,
                );
            }

            res.json({ videos });
        } catch (err) {
            const status = err.status || 400;
            res.status(status).json({ error: err.message });
        }
    }

    //[POST] /courses/playlist/store
    // Lưu nhiều video đã chọn từ playlist (client gửi videoid + title từ preview)
    async storePlaylist(req, res, next) {
        const items = Array.isArray(req.body.items) ? req.body.items : [];

        // Giới hạn số lượng mỗi lần thêm
        if (items.length === 0) {
            return res
                .status(400)
                .json({ error: 'Không có video nào được chọn' });
        }
        if (items.length > MAX_VIDEOS_PER_BATCH) {
            return res.status(400).json({
                error: `Tối đa ${MAX_VIDEOS_PER_BATCH} video mỗi lần thêm`,
            });
        }

        // Validate định dạng videoid (YouTube video ID luôn 11 ký tự)
        const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
        const validItems = [];
        const errors = [];
        for (const item of items) {
            const videoid = String(item.videoid || '').trim();
            const title = String(item.title || '').trim();
            if (!VIDEO_ID_REGEX.test(videoid)) {
                errors.push({
                    title: title || videoid,
                    reason: 'videoid không hợp lệ',
                });
                continue;
            }
            validItems.push({ videoid, title });
        }

        // Check trùng videoid trong DB trước khi insert.
        // Dùng Course.collection (raw) để thấy cả bản đã soft-delete
        // (Course.findOne bị mongoose-delete override → chỉ thấy bản active).
        const duplicate = [];
        const toInsert = [];
        for (const item of validItems) {
            const exists = await Course.collection.findOne({
                videoid: item.videoid,
            });
            if (exists) {
                duplicate.push(item.title || item.videoid);
            } else {
                toInsert.push(item);
            }
        }

        // Lưu theo batch concurrency 5, mỗi video độc lập (Promise.allSettled)
        const success = [];
        const CONCURRENCY = 5;

        async function saveWithRetry(courseData, maxRetries = 3) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                // Tạo document MỚI mỗi lần retry → pre('save') luôn chạy lại
                // (isModified('name') = true, !this.slug = true) → sinh slug mới
                const doc = new Course(courseData);
                try {
                    await doc.save();
                    return { ok: true };
                } catch (err) {
                    if (err.code === 11000 && attempt < maxRetries) {
                        continue; // race slug → retry với document mới
                    }
                    return { ok: false, error: err };
                }
            }
        }

        for (let i = 0; i < toInsert.length; i += CONCURRENCY) {
            const chunk = toInsert.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                chunk.map((item) =>
                    saveWithRetry({
                        name: item.title,
                        videoid: item.videoid,
                        image: `https://img.youtube.com/vi/${item.videoid}/sddefault.jpg`,
                        createdBy: req.user.id,
                    }),
                ),
            );
            results.forEach((result, idx) => {
                const item = chunk[idx];
                if (result.status === 'fulfilled' && result.value.ok) {
                    success.push(item.title || item.videoid);
                } else {
                    const reason =
                        result.status === 'rejected'
                            ? result.reason.message
                            : result.value.error && result.value.error.message;
                    errors.push({
                        title: item.title || item.videoid,
                        reason: reason || 'Lỗi không xác định',
                    });
                }
            });
        }

        res.json({ success, duplicate, errors });
    }
}

module.exports = new CourseController();
