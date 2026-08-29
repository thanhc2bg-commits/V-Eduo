const Course = require('../models/Course');
const Module = require('../models/Module');
const Video = require('../models/Video');
const PlaylistCache = require('../models/PlaylistCache');
const Enrollment = require('../models/Enrollment');
const Note = require('../models/Note');
const CourseReview = require('../models/CourseReview');
const User = require('../models/User');
const { getTotalVideosForCourse } = require('../../utils/progress');
const {
    mongooseToObject,
    multipleMongooseToObject,
} = require('../../utils/mongoose');
const {
    extractPlaylistId,
    extractVideoId,
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

            const enrollment = req.user
                ? await Enrollment.findOne({
                      userId: req.user.id,
                      courseId: course._id,
                  })
                : null;
            const isEnrolled = Boolean(enrollment);
            const isOwner = Boolean(
                course.createdBy &&
                    req.user &&
                    course.createdBy.equals(req.user.id),
            );
            const isAdmin = req.user && req.user.role === 'admin';

            // Không tiết lộ khóa học riêng tư và cây bài học cho người lạ.
            if (
                course.isPublic === false &&
                !isOwner &&
                !isAdmin &&
                !isEnrolled
            ) {
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
            // (nếu có cây). Course không còn lưu videoid — video quản lý qua Module/Video.
            let initialVideoId = null;
            if (modules.length > 0 && modules[0].videos.length > 0) {
                initialVideoId = modules[0].videos[0].youtubeId;
            }

            // Kiểm tra user đã enroll khóa học này chưa (để UI hiển thị nút enroll đúng trạng thái)
            // Tiến độ học (Phase 2) — chỉ tính khi user đã enroll
            let completedVideoIds = [];
            let progressPercent = 0;
            let enrollmentStatus = null;
            if (req.user && isEnrolled) {
                completedVideoIds = enrollment
                    ? enrollment.completedVideoIds.map(String)
                    : [];
                enrollmentStatus = enrollment ? enrollment.status : null;

                // Guard chia 0 (bản 2.2)
                const totalVideos = await getTotalVideosForCourse(course._id);
                progressPercent =
                    totalVideos > 0
                        ? Math.round(
                              (completedVideoIds.length / totalVideos) * 100,
                          )
                        : 0;
            }

            // Ghi chú của user theo video (Phase 2) — chỉ khi đã đăng nhập
            const noteCounts = {};
            if (req.user && modules.length > 0) {
                const myNotes = await Note.find({
                    userId: req.user.id,
                    videoId: {
                        $in: modules.flatMap((m) => m.videos.map((v) => v._id)),
                    },
                }).select('videoId');
                myNotes.forEach((n) => {
                    const key = n.videoId.toString();
                    noteCounts[key] = (noteCounts[key] || 0) + 1;
                });
            }

            // Reviews + rating trung bình (Phase 3) — public, không cần auth
            const reviewsRaw = await CourseReview.find({
                courseId: course._id,
            })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean();

            // Lấy tên user cho từng review — chỉ hiển thị name, không expose email
            const reviewUserIds = [
                ...new Set(reviewsRaw.map((r) => r.userId.toString())),
            ];
            const reviewUsers = await User.find({
                _id: { $in: reviewUserIds },
            })
                .select('name')
                .lean();
            const reviewUserMap = {};
            reviewUsers.forEach((u) => {
                reviewUserMap[u._id.toString()] = u.name;
            });

            const reviews = reviewsRaw.map((r) => ({
                ...r,
                userName: reviewUserMap[r.userId.toString()] || 'Người dùng',
            }));

            // Rating trung bình + số lượt
            const ratingAgg = await CourseReview.aggregate([
                { $match: { courseId: course._id } },
                {
                    $group: {
                        _id: null,
                        avg: { $avg: '$rating' },
                        count: { $sum: 1 },
                    },
                },
            ]);
            const avgRating = ratingAgg[0]
                ? Math.round(ratingAgg[0].avg * 10) / 10
                : 0;
            const reviewCount = ratingAgg[0] ? ratingAgg[0].count : 0;

            // Review của user hiện tại (để hiển thị form sửa nếu đã review)
            let myReview = null;
            if (req.user) {
                const found = await CourseReview.findOne({
                    userId: req.user.id,
                    courseId: course._id,
                });
                myReview = found ? mongooseToObject(found) : null;
            }

            res.render('courses/show', {
                title: course.name,
                course: mongooseToObject(course),
                modules, // đã là plain object (từ .lean()), không cần mongooseToObject
                hasTree: modules.length > 0,
                initialVideoId,
                isEnrolled,
                isOwner,
                completedVideoIds,
                progressPercent,
                enrollmentStatus,
                noteCounts,
                reviews,
                avgRating,
                reviewCount,
                myReview,
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
    // Flow mới: tạo Course → tự động tạo Module mặc định → tự động tạo Video mặc định
    // → redirect thẳng đến /courses/:id/manage (không còn bước trung gian /me/courses)
    async store(req, res, next) {
        const { ok, error } = validateCourse(req.body);
        if (!ok) {
            return res.status(400).send(error);
        }

        // Copy body nhưng LOẠI BỎ createdBy nếu client cố tính gửi lên
        const formData = { ...req.body };
        delete formData.createdBy;
        delete formData.videoid; // ✅ XÓA: trường cũ không còn dùng, đảm bảo không lọc vào Course

        // Trích xuất YouTube ID thuần (hỗ trợ cả URL và ID thuần)
        const youtubeId = extractVideoId(formData.youtubeId);
        if (!youtubeId) {
            return res.status(400).send('ID Video không hợp lệ');
        }

        // Sinh image thumbnail từ youtubeId
        formData.image = `https://img.youtube.com/vi/${youtubeId}/sddefault.jpg`;
        formData.createdBy = req.user.id; // bảo mật: luôn lấy từ token
        // 🔒 Checkbox không tick → req.body.certificate = undefined → ép về false tường minh
        formData.certificate =
            req.body.certificate === 'on' || req.body.certificate === true;

        try {
            // 1. Tạo document Course (không lưu videoid — video quản lý qua Module/Video)
            const course = new Course(formData);
            await course.save();

            // 2. Tạo Module mặc định liên kết với Course vừa tạo
            const module = new Module({
                name: 'Chương 1: Bắt đầu',
                courseId: course._id,
                order: 0,
            });
            await module.save();

            // 3. Tạo Video mặc định (dùng youtubeId từ form) liên kết vào Module vừa tạo
            //    Title mặc định = tên khóa học, fallback 'Video giới thiệu' nếu tên rỗng
            const video = new Video({
                youtubeId: youtubeId,
                moduleId: module._id,
                title: course.name || 'Video giới thiệu',
                order: 0,
            });
            await video.save();

            // 4. Redirect thẳng đến trang quản lý cấu trúc (đã có sẵn Module + Video)
            res.redirect(`/courses/${course._id}/manage`);
        } catch (err) {
            if (err.code === 11000) {
                return res.status(409).send('Trùng dữ liệu, vui lòng thử lại');
            }
            next(err);
        }
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

        const formData = {
            name: req.body.name,
            description: req.body.description,
            level: req.body.level,
            certificate:
                req.body.certificate === 'on' ||
                req.body.certificate === true,
        };
        // ✅ Cập nhật: dùng youtubeId thay vì videoid (đã xóa khỏi Course model)
        const youtubeId = extractVideoId(req.body.youtubeId);
        if (youtubeId) {
            formData.image = `https://img.youtube.com/vi/${youtubeId}/sddefault.jpg`;
        }
        // 🔒 Checkbox không tick → req.body.certificate = undefined → ép về false tường minh
        // (không để field bị bỏ trống khi update — luôn set đúng true/false)
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
                return res.json({
                    videos: cached.videos,
                    truncated: Boolean(cached.truncated),
                    fromCache: true,
                });
            }

            const { videos, truncated } = await fetchPlaylistVideos(
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
                    { playlistId, videos, truncated, fetchedAt: new Date() },
                    { upsert: true },
                );
            } catch (cacheErr) {
                console.error(
                    'Lỗi ghi playlist cache (bỏ qua, không ảnh hưởng response):',
                    cacheErr.message,
                );
            }

            res.json({ videos, truncated });
        } catch (err) {
            const status = err.status || 400;
            res.status(status).json({ error: err.message });
        }
    }

    //[POST] /courses/playlist/store
    // Lưu nhiều video đã chọn từ playlist → tạo 1 Course duy nhất + 1 Module + N Video.
    // Flow mới (tuân thủ cấu trúc Course → Module → Video):
    //   1. Validate danh sách video (youtubeId hợp lệ, title không rỗng)
    //   2. Tạo 1 Course (tên = video đầu tiên, không lưu videoid)
    //   3. Tạo 1 Module mặt định ('Danh sách phát YouTube')
    //   4. Bulk insert N Video (youtubeId, title) vào Module
    //   5. Trả JSON kết quả (success/duplicate/errors) — KHÔNG redirect vì
    //      client gọi qua fetch() cần JSON để hiển thị báo cáo.
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

        // 1. Validate định dạng youtubeId (YouTube video ID luôn 11 ký tự)
        //    Dùng extractVideoId để hỗ trợ cả URL và ID thuần
        const validItems = [];
        const errors = [];
        for (const item of items) {
            const rawYoutubeId = String(
                item.youtubeId || item.videoid || '',
            ).trim();
            const title = String(item.title || '').trim();
            const youtubeId = extractVideoId(rawYoutubeId);
            if (!youtubeId) {
                errors.push({
                    title: title || rawYoutubeId,
                    reason: 'youtubeId không hợp lệ',
                });
                continue;
            }
            validItems.push({ youtubeId, title });
        }

        // Nếu không có video hợp lệ nào → trả lỗi
        if (validItems.length === 0) {
            return res.status(400).json({
                error: 'Không có video hợp lệ nào trong danh sách',
                errors,
            });
        }

        // 1b. Loại trùng NGAY TRONG danh sách gửi lên (phòng trường hợp user vô tình
        //     chọn trùng 1 video 2 lần trong cùng 1 lần submit).
        //     KHÔNG truy vấn DB ở bước này: nghiệp vụ cho phép 1 video xuất hiện ở
        //     nhiều khóa học/module khác nhau, và storePlaylist luôn tạo Module MỚI
        //     nên dedup theo {youtubeId, moduleId} của DB sẽ không bao giờ bắt được trùng.
        //     Ràng buộc DB (Video.index unique {youtubeId, moduleId}) chỉ là lưới an toàn
        //     chặn race condition nếu 2 request insert đồng thời cùng module.
        const seen = new Set();
        const duplicateIds = [];
        const itemsToInsert = [];
        for (const item of validItems) {
            if (seen.has(item.youtubeId)) {
                duplicateIds.push(item.youtubeId);
            } else {
                seen.add(item.youtubeId);
                itemsToInsert.push(item);
            }
        }

        // Nếu sau khi loại trùng không còn video nào để thêm → báo rõ, không tạo Course rỗng
        if (itemsToInsert.length === 0) {
            return res.status(200).json({
                success: [],
                duplicate: duplicateIds,
                errors,
                courseId: null,
            });
        }

        try {
            // 2. Tạo 1 Course duy nhất (tên = video đầu tiên CHƯA trùng)
            const courseName = itemsToInsert[0].title || 'Khóa học từ playlist';
            const course = new Course({
                name: courseName,
                description: `Khóa học tự động tạo từ ${itemsToInsert.length} video`,
                image: `https://img.youtube.com/vi/${itemsToInsert[0].youtubeId}/sddefault.jpg`,
                createdBy: req.user.id,
                certificate:
                    req.body.certificate === 'on' ||
                    req.body.certificate === true,
            });
            await course.save();

            let module;
            try {
                // 3. Tạo 1 Module mặc định
                module = new Module({
                    name: 'Danh sách phát YouTube',
                    courseId: course._id,
                    order: 0,
                });
                await module.save();

                // 4. Bulk insert N Video vào Module (dùng insertMany để tối ưu hiệu năng)
                //    Chỉ insert những video CHƯA tồn tại (itemsToInsert đã loại trùng ở bước 1b)
                const videoDocs = itemsToInsert.map((item, index) => ({
                    youtubeId: item.youtubeId,
                    moduleId: module._id,
                    title: item.title || `Video ${index + 1}`,
                    order: index,
                }));
                await Video.insertMany(videoDocs, { ordered: false });
            } catch (innerErr) {
                // Module hoặc Video insert lỗi giữa chừng → dọn dẹp Course/Module
                // đã tạo để tránh orphan record. Không dùng MongoDB transaction vì
                // môi trường hiện tại chưa xác nhận là replica set (transaction chỉ
                // hoạt động trên replica set/mongos); cleanup thủ công hoạt động
                // được trên mọi cấu hình MongoDB, kể cả standalone.
                await Course.deleteOne({ _id: course._id }).catch((e) =>
                    console.error('Cleanup Course thất bại:', e.message),
                );
                if (module && module._id) {
                    await Module.deleteOne({ _id: module._id }).catch((e) =>
                        console.error('Cleanup Module thất bại:', e.message),
                    );
                    // Xóa luôn video đã insert thành công trước khi lỗi (nếu insertMany
                    // là ordered:false, một phần document có thể đã ghi thành công)
                    await Video.deleteMany({ moduleId: module._id }).catch(
                        (e) =>
                            console.error('Cleanup Video thất bại:', e.message),
                    );
                }
                throw innerErr; // ném lại để catch bên ngoài xử lý response
            }

            // 5. Trả JSON kết quả — client dùng để hiển thị báo cáo
            res.json({
                success: itemsToInsert.map((item) => item.youtubeId),
                duplicate: duplicateIds,
                errors,
                courseId: course._id,
            });
        } catch (err) {
            if (err.code === 11000) {
                // Log chi tiết để xác định chính xác nguồn conflict:
                // - Course.slug (unique) khi 2 request đồng thời tạo course cùng tên
                // - Video.{youtubeId, moduleId} (compound unique) khi race insert video
                console.error(
                    '[storePlaylist] E11000 duplicate key:',
                    JSON.stringify({
                        code: err.code,
                        keyPattern: err.keyPattern,
                        keyValue: err.keyValue,
                        message: err.message,
                    }),
                );
                return res
                    .status(409)
                    .json({ error: 'Trùng dữ liệu, vui lòng thử lại' });
            }
            next(err);
        }
    }
}

module.exports = new CourseController();
