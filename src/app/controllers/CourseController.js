const Course = require('../models/Course');
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
    show(req, res, next) {
        Course.findOne({ slug: req.params.slug })
            .then((course) =>
                res.render('courses/show', {
                    course: mongooseToObject(course),
                }),
            )
            .catch(next);
    }

    //[GET] /courses/create
    create(req, res, next) {
        res.render('courses/create');
    }

    //[POST] /courses/store
    store(req, res, next) {
        const { ok, error } = validateCourse(req.body);
        if (!ok) {
            return res.status(400).send(error);
        }

        const formData = req.body;
        formData.image = `https://img.youtube.com/vi/${formData.videoid}/sddefault.jpg`;
        const course = new Course(formData);

        course
            .save()
            .then(() => res.redirect('/courses/create'))
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
                    course: mongooseToObject(course),
                }),
            )
            .catch(next);
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
            .then(() => res.redirect('/me/courses/stored'))
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
            .then(() => res.redirect('/me/courses/stored'))
            .catch(next);
    }

    //[PATCH] /courses/:id/restore
    restore(req, res, next) {
        Course.restore({ _id: req.params.id })
            .then(() => res.redirect('/me/courses/trash'))
            .catch(next);
    }

    //[DELETE] /courses/:id/force
    forceDestroy(req, res, next) {
        Course.deleteOne({ _id: req.params.id })
            .then(() => res.redirect('/me/courses/trash'))
            .catch(next);
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

            const { videos } = await fetchPlaylistVideos(
                playlistId,
                process.env.YOUTUBE_API_KEY,
            );
            res.json({ videos });
        } catch (err) {
            res.status(400).json({ error: err.message });
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
