# Kế Hoạch Tích Hợp Tính Năng Học Tập — V-Connect

> Tài liệu lập kế hoạch chi tiết — **KHÔNG phải code thực thi**. Mọi code ví dụ trong tài liệu chỉ mang tính minh họa để làm rõ thiết kế.
> Tham khảo nguồn: phân tích code [CourseLit](.thamkhao/courselit) + đối chiếu với kiến trúc hiện tại của V-Connect.
> **Phiên bản 2.2** — vá 3 lỗi tiếp theo trước khi bắt đầu Phase 1: enroll() check course.isPublic + roadmap.visibility; getTotalVideosForCourse() lọc module.deleted; guard chia 0 cho progressPercent.

---

## 1. Tổng Quan

### 1.1 Mục tiêu

Bổ sung 5 tính năng học tập cốt lõi vào V-Connect, biến nền tảng từ "thư viện video quản lý khóa học" thành **nền tảng e-learning hoàn chỉnh**:

| # | Tính năng | Mức độ ưu tiên |
|---|---|---|
| 1 | Đánh dấu "đã hoàn thành" video + theo dõi tiến độ học (progress tracking) | ⭐ Cao nhất |
| 2 | Ghi chú cá nhân cho từng video | ⭐ Cao |
| 3 | Đánh giá / bình luận khóa học (rating, review) | ⭐ Cao |
| 4 | Chứng chỉ hoàn thành khóa học/lộ trình | ⭐ Trung bình |
| 5 | Lịch sử xem (watch history) | ⭐ Trung bình |

### 1.2 Kiến trúc hiện tại của V-Connect (tóm tắt)

```
Stack: Node.js + Express 5 + MongoDB/Mongoose + Handlebars (server-rendered) + Bootstrap 5 + jQuery
```

**Data models hiện có:**

```
User      { name, username, email, password, role: 'user'|'admin', plan: 'free'|'pro' }
Course    { name, description, image, videoid, level, slug, createdBy, roadmapId, roadmapOrder, isPublic }
Module    { name, courseId, order }
Video     { youtubeId, moduleId, title, order, duration, aiSubtitles, aiDubbing }
Roadmap   { name, description, slug, createdBy, isPublic, visibility, category, difficulty, coverImage }
Session   { userId, refreshToken, expiresAt }
```

**Nhận xét quan trọng:**
- Cấu trúc 3 cấp `Course → Module → Video` — tiến độ phải tính theo **Video**, nhóm theo **Module** để hiển thị.
- User đã có field `plan` (free/pro) nhưng **chưa được khai thác** — có thể dùng để mở khóa ghi chú không giới hạn (free: 20 note, pro: không giới hạn).
- Chưa có khái niệm **enrollment** (người học đăng ký tham gia khóa học) — chỉ có `createdBy` (người tạo). Cần thêm khái niệm này làm nền tảng cho progress/certificate/watch-history.

### 1.3 Nguyên tắc thiết kế

1. **Tuân thủ MVC hiện tại** — thêm model mới vào `src/app/models/`, controller vào `src/app/controllers/`, view vào `src/resources/views/`.
2. **Server-rendered + AJAX** — form truyền thống (có CSRF) cho thao tác tạo/sửa lớn, `fetch()` + `x-csrf-token` header cho thao tác nhỏ (giống Module/Video controller hiện tại).
3. **Phân quyền kế thừa mẫu có sẵn** — `requireAuth`, `checkOwnership`, `checkCourseOwnership` đã có mẫu rõ ràng.
4. **Idempotent + Atomic** — mọi API ghi (mark completed, like, đánh giá) phải an toàn khi gọi lặp **và** an toàn khi 2 request đồng thời (dùng `findOneAndUpdate` + `$addToSet`/`$set` thay vì `find` + `save`).
5. **Không phá luồng cũ** — khóa học không có module/video vẫn hoạt động (video `course.videoid` cũ là fallback).

---

## 2. Kiến Trúc Tích Hợp Tổng Thể

### 2.1 Sơ đồ dữ liệu mới

```
User (sửa) ─┬── embeds ── Progress[]          ← tiến độ từng khóa học
            └── embeds ── WatchHistory[]      ← lịch sử xem (hoặc collection riêng)

Video (sửa) ─ field: order (đã có) — không cần sửa

--- Các collection mới ---
Enrollment    { userId, courseId, status, enrolledAt, completedAt }   ← nền tảng
Note          { userId, videoId, courseId, content, createdAt, updatedAt }
CourseReview  { userId, courseId, rating (1-5), comment, createdAt }
Certificate   { userId, courseId, certificateId, issuedAt }
Activity      { userId, type, videoId?, courseId?, metadata, createdAt }   ← watch history + audit
```

### 2.2 Quan hệ nghiệp vụ

```
User 1 ──── N Enrollment ──── 1 Course
User 1 ──── N Note ──────────── 1 Video
User 1 ──── N CourseReview ──── 1 Course   (unique userId+courseId → 1 user chỉ review 1 lần)
User 1 ──── 1 Certificate ───── 1 Course    (unique userId+courseId → idempotent)
User 1 ──── N Activity ──────── 1 Video/Course (watch history, không unique)
```

### 2.3 Điểm tích hợp vào routes hiện tại

| Route hiện tại | Thay đổi |
|---|---|
| `GET /courses/:slug` | Thêm: nút "Đánh dấu hoàn thành" + progress bar + ghi chú + hiển thị rating |
| `GET /courses/create`, `/edit` | Thêm: checkbox "Cấp chứng chỉ" + setting rating |
| `GET /me/*` | Thêm: trang "Khóa học của tôi" hiển thị % tiến độ; trang "Lịch sử xem" |
| `GET /auth/*` | Không đổi |
| `POST /courses/:courseId/modules` (JSON) | Không đổi |
| `POST /modules/:moduleId/videos` (JSON) | Không đổi |

### 2.4 Route mới cần thêm

```
# Progress & Enrollment
POST   /api/courses/:courseId/enroll              → tham gia khóa học
POST   /api/videos/:videoId/complete              → đánh dấu hoàn thành video
DELETE /api/videos/:videoId/complete              → bỏ đánh dấu hoàn thành
GET    /api/courses/:courseId/progress            → lấy tiến độ chi tiết (JSON)

# Note
POST   /api/videos/:videoId/notes                 → tạo ghi chú
GET    /api/videos/:videoId/notes                 → danh sách ghi chú của tôi (theo video)
PUT    /api/notes/:id                             → sửa ghi chú
DELETE /api/notes/:id                             → xóa ghi chú

# Review
POST   /api/courses/:courseId/reviews             → tạo/bình luận + rating
GET    /api/courses/:courseId/reviews             → danh sách review
GET    /api/courses/:courseId/rating              → rating trung bình + số lượt

# Watch History
POST   /api/videos/:videoId/watch                 → ghi nhận video bắt đầu xem
GET    /me/watch-history                          → trang lịch sử xem (render HTML)

# Certificate
GET    /certificates/:certificateId               → trang chứng chỉ (public, không cần login)
GET    /api/certificates/:certificateId/download  → tải PDF (nâng cao, giai đoạn sau)
```

---

## 3. Chi Tiết Từng Tính Năng

---

### 3.1 🎯 Tính Năng 1: Đánh Dấu Hoàn Thành + Progress Tracking

#### 3.1.1 Data Model

**Quyết định thiết kế:**
- CourseLit nhúng `Progress[]` vào User. Nhưng V-Connect có thể có **nhiều khóa học lớn** → nhúng mọi thứ sẽ phình User document.
- **Đề xuất: Dùng collection `Enrollment` riêng** — sạch hơn, dễ query lịch sử, dễ khôi phục.

```js
// src/app/models/Enrollment.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Enrollment = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['active', 'completed'],
            default: 'active',
        },
        completedVideoIds: {
            // Chỉ lưu ID video đã hoàn thành — mỗi video tối đa 1 lần
            type: [Schema.Types.ObjectId],
            default: [],
        },
        completedAt: { type: Date, default: null },
    },
    { timestamps: true },
);

// 1 user chỉ enroll 1 lần / 1 khóa học
Enrollment.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', Enrollment);
```

#### 3.1.2 API Logic

**Controller mẫu — `ProgressController.js`:**

> 🔧 **SỬA LỖI #1 (Race condition):** Đoạn `enrollment.completedVideoIds.push(...); await enrollment.save()` trong bản cũ **không atomic** — 2 request đồng thời (double-click, 2 tab) có thể ghi đè mất lần hoàn thành trước. **Bắt buộc** dùng `findOneAndUpdate` + `$addToSet` (vừa atomic vừa tự idempotent — `$addToSet` không thêm trùng).

> 🚨 **SỬA LỖI #5 (BẢN 2.1) — LỖ HỔNG BẢO MẬT NGHIÊM TRỌNG:** Bản 2.0 dùng `findOneAndUpdate` + `upsert` ở bước 2 **vô tình auto-enroll cho MỌI user** (kể cả user chưa enroll), vô hiệu hoá hoàn toàn yêu cầu "phải đăng ký khóa học trước". **Phải tách 2 nhánh rõ ràng:**
> - **Nhánh 1:** Chưa có enrollment + KHÔNG phải owner → **trả 403** ("Bạn chưa đăng ký khóa học này") — không upsert.
> - **Nhánh 2:** Chưa có enrollment + LÀ owner (`course.createdBy.equals(req.user.id)`) → mới upsert tạo enrollment (auto-enroll cho owner).
> - **Nhánh 3:** Có enrollment rồi → tiếp tục xử lý bình thường.

```js
// POST /api/videos/:videoId/complete
async completeVideo(req, res, next) {
    try {
        const video = await Video.findById(req.params.videoId);
        if (!video) return res.status(404).json({ error: 'Video không tồn tại' });

        // 1. Lấy Course cha từ Module — KHÔNG nhận courseId từ client
        const module = await Module.findById(video.moduleId);
        if (!module) return res.status(404).json({ error: 'Module không tồn tại' });
        const course = await Course.findById(module.courseId);
        if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại' });

        // 2. Kiểm tra enrollment — bắt buộc
        let enrollment = await Enrollment.findOne({
            userId: req.user.id,
            courseId: module.courseId,
        });

        const isOwner = course.createdBy && course.createdBy.equals(req.user.id);

        // 2a. Nhánh 1: CHƯA enroll + KHÔNG phải owner → 403, KHÔNG upsert
        if (!enrollment && !isOwner) {
            return res.status(403).json({ error: 'Bạn chưa đăng ký khóa học này' });
        }

        // 2b. Nhánh 2: CHƯA enroll + LÀ owner → upsert tạo enrollment (auto-enroll owner)
        //     Sử dụng upsert + setDefaultsOnInsert: true (BẮT BUỘC với mọi upsert — mục 6.2)
        if (!enrollment && isOwner) {
            enrollment = await Enrollment.findOneAndUpdate(
                { userId: req.user.id, courseId: module.courseId },
                { $setOnInsert: { status: 'active', completedVideoIds: [] } },
                { new: true, upsert: true, setDefaultsOnInsert: true },
            );
        }

        // 2c. Nhánh 3: đã có enrollment → tiếp tục

        // 3. Atomic + idempotent: $addToSet không thêm trùng, không cần check includes() thủ công
        const updated = await Enrollment.findOneAndUpdate(
            { _id: enrollment._id },
            { $addToSet: { completedVideoIds: video._id } },
            { new: true },
        );

        // 4. Tính tiến độ: đủ 100% video published → hoàn thành khóa học
        //    (SỬA LỖI #9: dùng 1 pipeline aggregate thật, không N+1)
        const totalVideos = await getTotalVideosForCourse(module.courseId);
        const completedCount = updated.completedVideoIds.length;

        let courseCompleted = false;
        if (completedCount >= totalVideos && totalVideos > 0) {
            // Atomic: chỉ set completed khi chưa completed (tránh ghi đè completedAt)
            const completed = await Enrollment.findOneAndUpdate(
                { _id: updated._id, status: { $ne: 'completed' } },
                { $set: { status: 'completed', completedAt: new Date() } },
                { new: true },
            );
            courseCompleted = !!completed;

            // 5. Nếu hoàn thành → phát chứng chỉ (idempotent, xem mục 3.4)
            if (courseCompleted) {
                await issueCertificate(req.user.id, module.courseId);
            }
        }

        // 6. Ghi activity (watch history / audit) — lỗi ghi activity KHÔNG hủy mark completed
        try {
            await Activity.create({
                userId: req.user.id,
                type: 'video_completed',
                videoId: video._id,
                courseId: module.courseId,
            });
        } catch (activityErr) {
            console.error('Lỗi ghi activity (bỏ qua, không ảnh hưởng response):', activityErr.message);
        }

        // 🔧 BẢN 2.2 — Guard chia 0: nếu totalVideos = 0 thì progressPercent = 0 (không để NaN lọt vào JSON)
        const progressPercent = totalVideos > 0 ? Math.round((completedCount / totalVideos) * 100) : 0;

        res.json({
            completed: true,
            progressPercent,
            courseCompleted,
        });
    } catch (err) {
        next(err);
    }
}
```

> 🔧 **SỬA LỖI #9 — Helper tính tổng video bằng 1 pipeline thật (không N+1):**

```js
// src/app/utils/progress.js
const Module = require('../app/models/Module');
const Video = require('../app/models/Video');

// Đếm tổng số video của tất cả module thuộc course — 1 query duy nhất
async function getTotalVideosForCourse(courseId) {
    const result = await Video.aggregate([
        {
            $lookup: {
                from: 'modules',
                localField: 'moduleId',
                foreignField: '_id',
                as: 'module',
            },
        },
        { $unwind: '$module' },
        { $match: { 'module.courseId': courseId, deleted: { $ne: true }, 'module.deleted': { $ne: true } } },
        { $count: 'total' },
    ]);
    return result.length > 0 ? result[0].total : 0;
}
```

> 🔧 **SỬA LỖI #10 — Xác nhận hành vi `mongoose-delete` với `find`/`countDocuments`:**
> - `mongoose-delete` (plugin đang dùng cho Course/Module/Video) **tự động override** `find`, `findOne`, `countDocuments`, `findById`... để **loại bỏ bản ghi đã soft-delete** khỏi kết quả mặc định (đây là hành vi mặc định của plugin khi `overrideMethods: 'all'` — đúng như cấu hình hiện tại).
> - Tuy nhiên, **`aggregate()` KHÔNG bị override** — pipeline `$lookup` vào collection `modules`/`videos` sẽ **vẫn thấy bản đã soft-delete**.
> - **Hệ quả:** helper `getTotalVideosForCourse()` ở trên có thể đếm nhầm video đã xóa mềm.
> - **Cách xử lý:** thêm điều kiện lọc `deleted: { $ne: true }` vào pipeline (đã thêm ở trên).

> 🔧 **SỬA LỖI #3 — Rule tường minh cho `DELETE /api/videos/:videoId/complete`:**

**Quyết định (rule tường minh, không để ngỏ):**
- Khi user bỏ đánh dấu hoàn thành 1 video:
  - `enrollment.completedVideoIds` → `$pull` videoId ra (atomic).
  - `enrollment.status` → **revert về `'active'`** nếu trước đó là `'completed'` (vì không còn đủ 100%).
  - `enrollment.completedAt` → **set về `null`**.
  - **Chứng chỉ đã cấp → GIỮ NGUYÊN, KHÔNG thu hồi.** Chứng chỉ là **snapshot** tại thời điểm hoàn thành — không bị ảnh hưởng bởi hành động sau đó. (Lý do: tránh phức tạp thu hồi, tránh user mất chứng chỉ vì lỡ tay bỏ tick; nếu cần thu hồi thật thì phải có luồng admin riêng — ngoài phạm vi giai đoạn 1.)

```js
// DELETE /api/videos/:videoId/complete
async uncompleteVideo(req, res, next) {
    try {
        const video = await Video.findById(req.params.videoId);
        if (!video) return res.status(404).json({ error: 'Video không tồn tại' });
        const module = await Module.findById(video.moduleId);
        if (!module) return res.status(404).json({ error: 'Module không tồn tại' });

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
            return res.status(404).json({ error: 'Không tìm thấy enrollment' });
        }

        const totalVideos = await getTotalVideosForCourse(module.courseId);
        // 🔧 BẢN 2.2 — Guard chia 0: nếu totalVideos = 0 thì progressPercent = 0 (không để NaN lọt vào JSON)
        const progressPercent =
            totalVideos > 0
                ? Math.round((updated.completedVideoIds.length / totalVideos) * 100)
                : 0;

        res.json({
            completed: false,
            progressPercent,
        });
    } catch (err) {
        next(err);
    }
}
```

#### 3.1.3 UI

**Trang chi tiết khóa học (`courses/show.hbs`):**

```
┌──────────────────────────────────────────────┐
│  [ Thanh tiến độ khóa học ]  ██████░░░░ 60%  │
│  ──────────────────────────────────────────  │
│  [▶ Video 1: Giới thiệu]        ✅ Đã xong   │
│  [▶ Video 2: Cài đặt]           ✅ Đã xong   │
│  [▶ Video 3: Thực hành]         ⬜ Chưa xong │
│  [▶ Video 4: Tổng kết]          ⬜ Chưa xong │
│  [✔ Hoàn thành video này]                    │
└──────────────────────────────────────────────┘
```

**Nút "Đánh dấu hoàn thành"** — đặt dưới player YouTube:

```html
<button id="btn-complete-video" class="btn btn-outline-success" aria-pressed="false">
    ✔ Đánh dấu đã hoàn thành
</button>
```

Khi hoàn thành 100% → hiện banner đẹp + nút "Nhận chứng chỉ".

**Thanh tiến độ truyền từ server:**

```js
// CourseController.show — thêm dữ liệu progress
const enrollment = req.user
    ? await Enrollment.findOne({ userId: req.user.id, courseId: course._id })
    : null;

// 🔧 BẢN 2.2 — Guard chia 0: computedPercent = 0 khi course chưa có video (totalVideos = 0),
// tránh NaN lọt vào template render. Mọi nơi tính % tiến độ đều bắt buộc:
//   totalVideos > 0 ? Math.round(completed / totalVideos * 100) : 0
const totalVideos = await getTotalVideosForCourse(course._id);
const computedPercent =
    totalVideos > 0
        ? Math.round((enrollment?.completedVideoIds.length || 0) / totalVideos * 100)
        : 0;

res.render('courses/show', {
    ...,
    isEnrolled: !!enrollment,
    completedVideoIds: enrollment?.completedVideoIds.map(String) || [],
    progressPercent: computedPercent,
});
```

#### 3.1.4 Rủi ro & Cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| User mark giả mạo (POST video của khóa khác) | Luôn truy ngược `Video → Module → Course`, check enrollment |
| **Race condition** (2 request đồng thời) | `findOneAndUpdate` + `$addToSet` — atomic + idempotent (SỬA LỖI #1) |
| Mark trùng lặp → tràn mảng | `$addToSet` tự loại trùng — không cần check `includes()` thủ công |
| **Auto-enroll vô hiệu hoá check enrollment** (LỖ HỔNG BẢN 2.0) | Tách 2 nhánh: chưa enroll + không phải owner → 403; chưa enroll + là owner → upsert (SỬA LỖI #5 bản 2.1) |
| User không đăng nhập | `requireAuth` middleware (đã có) |
| CSRF | `x-csrf-token` header từ meta tag (đã có pattern ở manage.hbs) |
| N+1 query khi tính total | `getTotalVideosForCourse()` — 1 aggregate pipeline (SỬA LỖI #9) |
| Đếm nhầm video đã soft-delete | Thêm `deleted: { $ne: true }` vào pipeline (SỬA LỖI #10) |

---

### 3.2 📝 Tính Năng 2: Ghi Chú Cá Nhân Cho Từng Video

#### 3.2.1 Data Model

```js
// src/app/models/Note.js
const Note = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        videoId: { type: Schema.Types.ObjectId, ref: 'Video', required: true, index: true },
        courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
        content: {
            type: String,
            required: [true, 'Nội dung ghi chú không được để trống'],
            maxLength: 5000,  // giới hạn độ dài
            trim: true,
        },
    },
    { timestamps: true },
);

Note.index({ userId: 1, videoId: 1, createdAt: -1 });
module.exports = mongoose.model('Note', Note);
```

> 💡 **Mở rộng pro:** thêm field `plan` trong User để giới hạn — user free tối đa 20 note, pro không giới hạn. Check trong controller:
> ```js
> const noteCount = await Note.countDocuments({ userId: req.user.id });
> if (req.user.plan !== 'pro' && noteCount >= 20) {
>     return res.status(403).json({ error: 'Gói miễn phí giới hạn 20 ghi chú. Nâng cấp Pro để không giới hạn.' });
> }
> ```

#### 3.2.2 API Logic

```js
// POST /api/videos/:videoId/notes
async store(req, res, next) {
    const { content } = req.body;
    if (!content || !String(content).trim()) {
        return res.status(400).json({ error: 'Nội dung ghi chú không được để trống' });
    }
    if (String(content).length > 5000) {
        return res.status(400).json({ error: 'Ghi chú tối đa 5000 ký tự' });
    }

    // Xác nhận video tồn tại + lấy courseId để lưu kèm
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ error: 'Video không tồn tại' });
    const module = await Module.findById(video.moduleId);

    const note = await Note.create({
        userId: req.user.id,
        videoId: video._id,
        courseId: module.courseId,
        content: String(content).trim(),
    });

    res.status(201).json({ note: mongooseToObject(note) });
}

// GET /api/videos/:videoId/notes — CHỈ trả note của chính user
async index(req, res, next) {
    const notes = await Note.find({
        userId: req.user.id,
        videoId: req.params.videoId,
    }).sort({ createdAt: -1 });

    res.json({ notes: multipleMongooseToObject(notes) });
}
```

> 🔧 **SỬA LỖI #4 — PUT/DELETE Note bắt buộc ràng buộc ownership trong CÙNG 1 lệnh query:**
> **KHÔNG** tách "tìm note rồi check quyền" (dễ bị agent code sai thành IDOR). **Bắt buộc** query kèm `userId: req.user.id` ngay trong filter của `findOneAndUpdate`/`findOneAndDelete` — nếu không khớp thì trả 404 (không tiết lộ note tồn tại).

```js
// PUT /api/notes/:id
async update(req, res, next) {
    const { content } = req.body;
    if (!content || !String(content).trim()) {
        return res.status(400).json({ error: 'Nội dung ghi chú không được để trống' });
    }
    if (String(content).length > 5000) {
        return res.status(400).json({ error: 'Ghi chú tối đa 5000 ký tự' });
    }

    // 🔒 BẮT BUỘC: filter gồm cả _id + userId — không tách rời
    const note = await Note.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.id },
        { $set: { content: String(content).trim() } },
        { new: true, runValidators: true },
    );

    if (!note) {
        // Trả 404 thay vì 403 — không tiết lộ note có tồn tại hay không
        return res.status(404).json({ error: 'Ghi chú không tồn tại' });
    }

    res.json({ note: mongooseToObject(note) });
}

// DELETE /api/notes/:id
async destroy(req, res, next) {
    // 🔒 BẮT BUỘC: filter gồm cả _id + userId — không tách rời
    const note = await Note.findOneAndDelete({
        _id: req.params.id,
        userId: req.user.id,
    });

    if (!note) {
        return res.status(404).json({ error: 'Ghi chú không tồn tại' });
    }

    res.json({ message: 'Đã xóa ghi chú' });
}
```

#### 3.2.3 UI

**Panel ghi chú** — đặt dưới description của khóa học, có nút toggle:

```
┌─ 📝 Ghi chú của tôi ──────────────────┐
│  [ Nội dung ghi chú...          ]      │
│  [ ＋ Thêm ghi chú ]                   │
│  ─────────────────────────────────    │
│  📌 Ghi nhớ: dùng oEmbed để lấy...     │
│     12/08/2026  (Sửa) (Xóa)           │
│  📌 Cần xem lại phần 3:30 phút        │
│     10/08/2026  (Sửa) (Xóa)           │
└───────────────────────────────────────┘
```

> 🔧 **SỬA LỖI #12 — Chuẩn hoá 1 hàm `escapeHtml()` dùng chung:**
> Tạo file `src/public/js/escape-html.js` (hoặc thêm vào file JS dùng chung hiện có) — **1 hàm duy nhất** dùng cho cả note lẫn review, tránh mỗi view tự viết lại (dễ sót chỗ dùng `.html()` thay vì `.text()`):

```js
// src/public/js/escape-html.js — dùng chung cho note/review
// Load trước mọi script AJAX chèn nội dung người dùng vào DOM
function escapeHtml(str) {
    return $('<div>').text(str).html();
}
```

**Quy tắc bắt buộc khi code:**
- Mọi nội dung người dùng (note content, review comment) chèn vào DOM qua AJAX **PHẢI** đi qua `escapeHtml()`.
- **CẤM** dùng `.html()` trực tiếp với biến chứa nội dung người dùng.
- Handlebars render server đã auto-escape — chỉ cần cẩn thận ở phía client AJAX.

#### 3.2.4 Rủi ro & Cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Ghi chú là nội dung người dùng → **XSS** | Handlebars auto-escape khi render server; khi AJAX dùng `escapeHtml()` chung (SỬA LỖI #12); CSP script-src đã hạn chế (index.js) |
| User B đọc được note của user A | Mọi query Note đều kèm `userId: req.user.id` — bắt buộc |
| **IDOR** — user B sửa/xóa note của user A | `findOneAndUpdate`/`findOneAndDelete` với filter `{ _id, userId }` trong CÙNG 1 lệnh (SỬA LỖI #4) |
| Note quá dài → phình DB | `maxLength: 5000` + validate server |
| Ghi chú vô nghĩa tự động (spam) | Rate limit 10 note/phút theo **userId** (SỬA LỖI #7) |
| Course bị xóa → note mồ côi | Cascade xóa Note khi Course/Video bị forceDestroy (sửa CourseController.forceDestroy) |

---

### 3.3 ⭐ Tính Năng 3: Đánh Giá / Bình Luận Khóa Học (Rating + Review)

#### 3.3.1 Data Model

```js
// src/app/models/CourseReview.js
const CourseReview = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
        rating: {
            type: Number,
            required: [true, 'Vui lòng chọn số sao'],
            min: [1, 'Rating tối thiểu 1 sao'],
            max: [5, 'Rating tối đa 5 sao'],
        },
        comment: {
            type: String,
            maxLength: 2000,
            trim: true,
            default: '',
        },
        // Hỗ trợ bình luận phản hồi (reply) — giữ đơn giản ở giai đoạn 1:
        // không cần reply, chỉ đánh giá + bình luận
    },
    { timestamps: true },
);

// 1 user chỉ đánh giá 1 lần cho 1 khóa học — chống spam rating
CourseReview.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('CourseReview', CourseReview);
```

> 💡 **Giai đoạn 2 (mở rộng):** thêm collection `CourseReviewReply` (giống ProductDiscussionReply của CourseLit) nếu cần admin trả lời review.

#### 3.3.2 API Logic

> 🔧 **SỬA LỖI #2 (`new mongoose.Types.ObjectId`):** Với Mongoose ≥6 (dự án dùng Express 5 nên gần như chắc chắn Mongoose mới), gọi `mongoose.Types.ObjectId(x)` **thiếu `new`** sẽ throw `TypeError`. **Bắt buộc** dùng `new mongoose.Types.ObjectId(x)` + `mongoose.isValidObjectId(x)` validate trước khi cast.

> 🔧 **XÁC NHẬN UPSERT (mục 6.2):** Mọi lệnh `findOneAndUpdate` có `upsert: true` trong kế hoạch **BẮT BUỘC** kèm `setDefaultsOnInsert: true` (và `context: 'query'` nếu schema có validator dạng query như `min`/`max`). Đã áp dụng cho:
> - `Enrollment` upsert trong `enroll()` — mục 6.2
> - `Enrollment` upsert trong `completeVideo()` (owner) — mục 3.1.2
> - `CourseReview` upsert trong `store()` — mục này

```js
// POST /api/courses/:courseId/reviews
async store(req, res, next) {
    const { rating, comment } = req.body;
    const ratingNum = Number(rating);

    // Validate
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'Rating phải là số nguyên từ 1 đến 5' });
    }
    if (comment !== undefined && String(comment).length > 2000) {
        return res.status(400).json({ error: 'Bình luận tối đa 2000 ký tự' });
    }

    // 🔒 (SỬA LỖI #2) Check course tồn tại trước (Vấn đề E mục 9.2)
    const courseId = req.params.courseId;
    if (!mongoose.isValidObjectId(courseId)) {
        return res.status(400).json({ error: 'Course ID không hợp lệ' });
    }
    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const course = await Course.findById(courseObjectId);
    if (!course) {
        return res.status(404).json({ error: 'Khóa học không tồn tại' });
    }

    // Chỉ user đã enroll mới được đánh giá — chống review giả
    const enrollment = await Enrollment.findOne({
        userId: req.user.id,
        courseId: courseObjectId,
    });
    if (!enrollment) {
        return res.status(403).json({ error: 'Bạn phải tham gia khóa học để đánh giá' });
    }

    // 🔧 (SỬA LỖI #6) Upsert phải có setDefaultsOnInsert: true + context: 'query'
    // - setDefaultsOnInsert: default field (comment: '') được set khi INSERT mới
    // - context: 'query': validator min/max hoạt động đúng trên upsert
    const review = await CourseReview.findOneAndUpdate(
        { userId: req.user.id, courseId: courseObjectId },
        { rating: ratingNum, comment: String(comment || '').trim() },
        {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            context: 'query',
        },
    );

    // Tính lại rating trung bình — dùng new + isValidObjectId (SỬA LỖI #2)
    const agg = await CourseReview.aggregate([
        { $match: { courseId: courseObjectId } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    res.json({
        review: mongooseToObject(review),
        avgRating: agg[0] ? Math.round(agg[0].avg * 10) / 10 : ratingNum,
        reviewCount: agg[0] ? agg[0].count : 1,
    });
}
```

#### 3.3.3 UI

**Trang khóa học — section Review:**

```
┌── ⭐ Đánh giá khóa học ────────────────┐
│  ★★★★☆  4.2/5  (128 đánh giá)          │
│  ────────────────────────────────────  │
│  [★★★★★☆☆☆☆☆]  ← click chọn số sao    │
│  [ Viết bình luận của bạn...        ]  │
│  [ Gửi đánh giá ]                       │
│  ────────────────────────────────────  │
│  ⭐★★★★★ Nguyễn Văn A           12/08 │
│  "Khóa học rất dễ hiểu, nhờ đó tôi..."  │
│  ⭐★★★☆☆ Trần Thị B             10/08 │
│  "Nội dung tốt nhưng cần thêm bài tập." │
└───────────────────────────────────────┘
```

**Rating stars UI (jQuery, có thể dùng thư viện hoặc tự làm):**

```html
<div class="rating-input" data-course-id="{{course._id}}">
    <button type="button" class="star" data-value="1" aria-label="Đánh giá 1 sao">☆</button>
    <button type="button" class="star" data-value="2" aria-label="Đánh giá 2 sao">☆</button>
    <button type="button" class="star" data-value="3" aria-label="Đánh giá 3 sao">☆</button>
    <button type="button" class="star" data-value="4" aria-label="Đánh giá 4 sao">☆</button>
    <button type="button" class="star" data-value="5" aria-label="Đánh giá 5 sao">☆</button>
</div>
```

#### 3.3.4 Rủi ro & Cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| **Spam rating** (1 user 1000 lần) | Unique index `{ userId, courseId }` — upsert thay vì create |
| **Rating giả** (chưa học) | Bắt buộc enrollment trước khi review |
| **Rating 0/6** (ngoài khoảng) | Mongoose `min/max` validator + validate thủ công |
| **Rate limit** | Thêm `reviewLimiter` (10 review/giờ) theo **userId** (SỬA LỖI #7) |
| **XSS trong comment** | `escapeHtml()` chung (SỬA LỖI #12); Handlebars auto-escape khi render server |
| **NoSQL injection courseId** | `mongoose.isValidObjectId()` + `new mongoose.Types.ObjectId()` (SỬA LỖI #2) |
| **Upsert default field không hoạt động** | `setDefaultsOnInsert: true` + `context: 'query'` (SỬA LỖI #6) |
| Hiển thị rating trung bình mỗi request tốn query | Có thể lưu cache `avgRating` trên Course (denormalized) — hẹn giai đoạn 2 |

---

### 3.4 🏆 Tính Năng 4: Chứng Chỉ Hoàn Thành

#### 3.4.1 Data Model

```js
// src/app/models/Certificate.js — model user-course hoàn thành
const Certificate = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
        certificateId: {
            type: String,
            unique: true,
            required: true,
            // Tạo ID ngẫu nhiên khó đoán — chống quét/giả mạo chứng chỉ
            default: () => crypto.randomBytes(16).toString('hex'),
        },
        // Giai đoạn 2 (mở rộng — BẢN 2.1 XÁC NHẬN):
        // isPublic mặc định TRUE — certificate cũ (giai đoạn 1, không có field này)
        // vẫn được coi là public khi query (fallback undefined → true), không phá vỡ
        // certificate đã cấp trước đó.
        isPublic: { type: Boolean, default: true },
    },
    { timestamps: true },
);

// 1 user chỉ có 1 chứng chỉ / 1 khóa — idempotent
Certificate.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('Certificate', Certificate);
```

```js
// src/app/models/CertificateTemplate.js — template tùy chỉnh (admin set)
const CertificateTemplate = new Schema(
    {
        courseId: { type: Schema.Types.ObjectId, ref: 'Course', unique: true },
        title: { type: String, default: 'Chứng chỉ hoàn thành' },
        subtitle: { type: String, default: 'Chứng chỉ này được trao cho' },
        description: { type: String, default: 'đã hoàn thành xuất sắc khóa học' },
        signatureName: { type: String, default: '' },
        signatureDesignation: { type: String, default: '' },
        logoUrl: { type: String, default: '' },
    },
    { timestamps: true },
);

module.exports = mongoose.model('CertificateTemplate', CertificateTemplate);
```

> 🔒 **Bảo mật certificateId:** dùng `crypto.randomBytes(16).toString('hex')` (32 ký tự hex, ~128 bit entropy) — tuyệt đối **KHÔNG dùng** `_id` của Mongo (dễ đoán, dễ quét).

> 🔧 **BẢN 2.1 — XÁC NHẬN `isPublic`:** Field `isPublic: { type: Boolean, default: true }` thêm ở **giai đoạn 2** với mặc định `true`. Khi render certificate cũ (giai đoạn 1 — không có field này):
> ```js
> // CertificateController.show
> const cert = await Certificate.findOne({ certificateId: req.params.certificateId });
> // cert.isPublic === undefined (certificate cũ) → coi là public (không chặn)
> if (cert.isPublic === false) {
>     // chỉ owner đăng nhập xem được
> }
> ```
> → Certificate cũ vẫn hiển thị bình thường, không bị phá vỡ. Nếu user muốn ẩn chứng chỉ, chỉ cần set `isPublic: false` từ UI user (tính năng này thuộc giai đoạn 2, không ảnh hưởng giai đoạn 1).

#### 3.4.2 Luồng phát chứng chỉ (tự động)

```
User hoàn thành 100% video (ProgressController.completeVideo)
   └── enrollment.status = 'completed'
        └── Gọi issueCertificate(userId, courseId)
             ├── Check: Certificate đã tồn tại? → return (idempotent)
             ├── Tạo Certificate mới (certificateId ngẫu nhiên)
             └── Ghi Activity 'certificate_issued'
```

```js
// src/app/utils/certificate.js (helper)
async function issueCertificate(userId, courseId) {
    try {
        // Idempotent: tránh phát trùng nếu race condition
        const existing = await Certificate.findOne({ userId, courseId });
        if (existing) return existing;

        const certificate = await Certificate.create({ userId, courseId });

        await Activity.create({
            userId,
            type: 'certificate_issued',
            courseId,
            metadata: { certificateId: certificate.certificateId },
        });

        return certificate;
    } catch (err) {
        // unique index bắt race → lấy lại bản đã có
        if (err.code === 11000) {
            return Certificate.findOne({ userId, courseId });
        }
        throw err;
    }
}
```

> 🎯 **Điểm quan trọng (theo CourseLit):** việc phát chứng chỉ **luôn do server kiểm tra hoàn thành 100%** mới gọi `issueCertificate()` — **không bao giờ** cho client POST trực tiếp tạo chứng chỉ.

#### 3.4.3 UI — Trang chứng chỉ

`GET /certificates/:certificateId` — **public, không cần đăng nhập** (để học viên chia sẻ lên LinkedIn/Facebook). Trong giai đoạn 2, nếu `certificate.isPublic === false` → chỉ owner đăng nhập mới xem được.

> 🔧 **SỬA LỖI #11 — Thêm rate-limit nhẹ cho trang certificate public:**
> Dù certificateId đã 128-bit ngẫu nhiên, vẫn cần chống **scrape ID hàng loạt** (kẻ tấn công brute-force nhiều ID). Thêm `certificateLimiter` — **theo IP** (vì route public, chưa có user):

```js
// src/app/middlewares/rateLimit.js — thêm limiter mới
const certificateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 60, // tối đa 60 request / IP — đủ cho user thật, chặn brute-force
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});
```

```
┌──────────────────────────────────────────────┐
│            🏆 CHỨNG CHỈ HOÀN THÀNH            │
│   ┌────────────────────────────────────┐     │
│   │        [ Logo V-Connect ]           │     │
│   │                                     │     │
│   │  Chứng chỉ này được trao cho        │     │
│   │   NGUYỄN VĂN A                     │     │
│   │                                     │     │
│   │  đã hoàn thành khóa học             │     │
│   │  "Lập Trình Node.js Từ Cơ Bản"      │     │
│   │                                     │     │
│   │  Ngày: 19/08/2026                   │     │
│   │                                     │     │
│   │  [Chữ ký]  [Chữ ký]                │     │
│   │  Giám đốc   Giảng viên             │     │
│   │  [ Mã xác thực: a3f9...c2e1 ]       │     │
│   └────────────────────────────────────┘     │
│  [ In chứng chỉ ]  [ Tải PDF ]               │
└──────────────────────────────────────────────┘
```

#### 3.4.4 Rủi ro & Cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Tự tạo chứng chỉ giả (POST) | **Không có route POST tạo certificate** — chỉ server tự phát sau khi xác minh 100% |
| Quét certificateId để xem trộm thông tin | certificateId 128-bit ngẫu nhiên + `certificateLimiter` theo IP (SỬA LỖI #11) |
| Phát trùng do race condition | Unique index + catch code 11000 |
| Chứng chỉ hiển thị tên người khác | Query theo certificateId → lấy userId của certificate đó, không nhận từ client |
| Course sau này thêm video mới → chứng chỉ cũ vô nghĩa | (Quyết định sản phẩm) Giai đoạn 1: chứng chỉ giữ nguyên như snapshot thời điểm hoàn thành. Giai đoạn 2: lưu `completedVideoIds` snapshot bên trong Certificate |
| Certificate public lộ tên người hoàn thành | Giai đoạn 2: thêm `isPublic: Boolean default: true` — certificate cũ vẫn public (fallback undefined→true), user có thể tự ẩn (BẢN 2.1 XÁC NHẬN) |

---

### 3.5 📺 Tính Năng 5: Lịch Sử Xem (Watch History)

#### 3.5.1 Data Model

```js
// src/app/models/Activity.js — watch history + audit events
const Activity = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        type: {
            type: String,
            required: true,
            enum: [
                'video_started',
                'video_completed',
                'course_enrolled',
                'course_completed',
                'certificate_issued',
                'review_submitted',
            ],
        },
        videoId: { type: Schema.Types.ObjectId, ref: 'Video', default: null },
        courseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null },
        metadata: { type: Schema.Types.Mixed, default: {} }, // lưu title, thumbnail snapshot...
    },
    { timestamps: true },
);

// Lịch sử xem: query theo user + time
Activity.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', Activity);
```

> 💡 **Khác với CourseLit:** CourseLit deduplicate activity (mỗi video chỉ ghi 1 lần) — phù hợp "activity feed". Nhưng **watch history** cần **nhiều entry cho cùng video** (xem lại lần 2, 3...) → V-Connect **KHÔNG dedup** `video_started`. `video_completed` vẫn có thể dedup để tránh spam.

#### 3.5.2 API Logic

> 🔧 **BẢN 2.1 — SỬA LỖI bỏ sót check quyền xem course:** Bản 2.0 xác nhận "recordWatch giữ nguyên vì cho phép xem thử" — NHƯNG đây là **SÓT**, không phải chủ đích, vì: course có thể là **private/draft** (`course.isPublic === false`). User chưa enroll + course private vẫn ghi được watch history là lỗ hổng. **Quyết định sửa:** thêm check quyền xem course:
> - Course **public** (`isPublic: true`) → cho phép ghi watch (xem thử — UX tốt).
> - Course **private** (`isPublic: false`) → chỉ cho phép: (a) owner, hoặc (b) đã enroll. Trả 403 nếu không thuộc 2 trường hợp.

```js
// POST /api/videos/:videoId/watch — client gọi khi user mở/xem video
// (gọi 1 lần khi video load, không gọi lặp trong cùng phiên xem)
async recordWatch(req, res, next) {
    try {
        const video = await Video.findById(req.params.videoId);
        if (!video) return res.status(404).json({ error: 'Video không tồn tại' });
        const module = await Module.findById(video.moduleId);
        if (!module) return res.status(404).json({ error: 'Module không tồn tại' });
        const course = await Course.findById(module.courseId);
        if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại' });

        // 🔒 BẢN 2.1: check quyền xem course trước khi ghi watch
        // - Course public → cho ghi (xem thử)
        // - Course private/draft → chỉ owner hoặc enrolled mới ghi được
        if (!course.isPublic) {
            const isOwner = course.createdBy && course.createdBy.equals(req.user.id);
            const isEnrolled = await Enrollment.exists({
                userId: req.user.id,
                courseId: module.courseId,
            });
            if (!isOwner && !isEnrolled) {
                return res.status(403).json({ error: 'Bạn không có quyền xem khóa học này' });
            }
        }

        await Activity.create({
            userId: req.user.id,
            type: 'video_started',
            videoId: video._id,
            courseId: module.courseId,
            metadata: {
                title: video.title,
                youtubeId: video.youtubeId,
            },
        });

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}

// GET /me/watch-history — trang HTML
async watchHistory(req, res, next) {
    try {
        // Phân trang: 20 activity/trang
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const activities = await Activity.find({ userId: req.user.id, type: 'video_started' })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // Group theo ngày để hiển thị "Hôm nay", "Hôm qua", "Tuần này"
        const grouped = groupByDay(activities);

        res.render('me/watch-history', {
            grouped,
            pagination: { page, hasMore: activities.length === limit },
        });
    } catch (err) {
        next(err);
    }
}
```

#### 3.5.3 UI — Trang lịch sử xem

```
┌── 🕘 Lịch sử xem của tôi ──────────────┐
│  ┌─ Hôm nay ─────────────────────────┐ │
│  │  🎬 Lập trình Node.js — Bài 3     │
│  │     19/08 10:30 · Khóa: NodeJS    │ │
│  │  🎬 Lập trình Node.js — Bài 2     │
│  │     19/08 09:15 · Khóa: NodeJS    │ │
│  └───────────────────────────────────┘ │
│  ┌─ Hôm qua ─────────────────────────┐ │
│  │  🎬 Giới thiệu MongoDB — Bài 5    │
│  │     18/08 20:04 · Khóa: MongoDB   │ │
│  └───────────────────────────────────┘ │
│  [← Trước]  [Sau →]                    │
└───────────────────────────────────────┘
```

#### 3.5.4 Rủi ro & Cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Client spam POST watch → phình DB | (a) Rate limit 30/phút theo **userId** (SỬA LỖI #7); (b) client chỉ gọi 1 lần khi video load; (c) thêm log cleanup sau 90 ngày (script `scripts/cleanup-old-activities.js`) |
| **Ghi watch cho course private/draft** (SÓT BẢN 2.0) | Thêm check `course.isPublic` — private: chỉ owner/enrolled; public: cho phép (BẢN 2.1 SỬA) |
| Lịch sử xem là dữ liệu riêng tư | Route `GET /me/watch-history` bắt buộc `requireAuth` + query luôn kèm `userId: req.user.id` — không có tham số userId từ client |
| Xóa user → activity mồ côi | Khi xóa user (chưa có tính năng, giai đoạn sau) phải cascade xóa Activity |
| Hiệu năng khi hàng trăm nghìn activity | Compound index `{ userId: 1, createdAt: -1 }` + phân trang skip/limit (hoặc cursor-based nếu cần) |

---

## 4. 🛡️ Bảng Tổng Hợp Rủi Ro Bảo Mật & Cách Xử Lý

### 4.1 Bảo mật ứng dụng

| # | Rủi ro | Phạm vi | Cách xử lý | File cần sửa/thêm |
|---|---|---|---|---|
| 1 | **XSS** — note/review là nội dung người dùng | Note, Review, Comment | Handlebars auto-escape; AJAX luôn dùng `escapeHtml()` chung (SỬA LỖI #12); CSP hiện có hạn chế `script-src` | `src/public/js/escape-html.js` (mới) |
| 2 | **CSRF** — mọi POST/PUT/DELETE | Tất cả API mới | Dùng `csrfToken` đã có: form dùng `_csrf` hidden; fetch dùng header `x-csrf-token` từ `meta[name=csrf-token]` | Mọi view mới |
| 3 | **IDOR** (truy cập trái phép tài nguyên người khác) | Note, WatchHistory, Progress | Mọi query gắn `userId: req.user.id`; **Note update/delete dùng filter `{ _id, userId }` trong CÙNG 1 lệnh** (SỬA LỖI #4) | ProgressController, NoteController |
| 4 | **Authorization** — user chưa enroll mark completed/review | Progress, Review | `requireAuth` + tách 2 nhánh: chưa enroll + không phải owner → 403 (SỬA LỖI #5 bản 2.1); chưa enroll + là owner → upsert; check `Video→Module→Course` | ProgressController, ReviewController |
| 5 | **Auto-enroll vô hiệu hoá check enrollment** (LỖ HỔNG BẢN 2.0) | Progress | KHÔNG upsert cho mọi user — chỉ upsert khi `course.createdBy === req.user.id`; mọi user khác chưa enroll phải 403 (SỬA LỖI #5 bản 2.1) | ProgressController |
| 6 | **Giả mạo chứng chỉ** | Certificate | Không có route POST tạo; server tự phát sau 100%; certificateId 128-bit ngẫu nhiên | CertificateController, utils/certificate.js |
| 7 | **NoSQL injection** — courseId/videoId độc hại | Mọi API | `mongoose.isValidObjectId()` + `new mongoose.Types.ObjectId()` (SỬA LỖI #2); error handler CastError → 400 (đã có ở index.js) | Mongoose tự xử lý |
| 8 | **Rate limiting** — spam comment/note/watch | Review, Note, Watch | Thêm `reviewLimiter`, `noteLimiter`, `watchLimiter` — **theo `userId`** vì route đã qua `requireAuth` (SỬA LỖI #7) | middlewares/rateLimit.js |
| 9 | **Unvalidated input** — rating 6, note 100k ký tự | Review, Note | Mongoose `min/max/maxLength` + validate thủ công ở controller | Model + Controller |
| 10 | **Race condition** phát trùng certificate/create trùng review | Certificate, Review | Unique index `{ userId, courseId }` + upsert + catch code 11000 | Model + Controller |
| 11 | **Ghi watch history vào course private** (SÓT BẢN 2.0) | Watch | Check `course.isPublic` — private: chỉ owner/enrolled; public: cho phép (BẢN 2.1 SỬA) | ProgressController.recordWatch |

### 4.2 Bảo mật dữ liệu & quyền riêng tư

| # | Rủi ro | Cách xử lý |
|---|---|---|
| 12 | Ghi chú cá nhân bị lộ | Chỉ user sở hữu query được; không render note trong bất kỳ trang public nào; không trả note qua API không cần auth |
| 13 | Lịch sử xem bị lộ | Route `/me/watch-history` bắt buộc `requireAuth`; KHÔNG có API public trả watch history |
| 14 | Review hiển thị email/username người đánh giá | Chỉ hiển thị `name` của user (đã có pattern `res.locals.user`); không expose email |
| 15 | Certificate chứa thông tin cá nhân bị quét | certificateId ngẫu nhiên 128-bit + `certificateLimiter` theo IP (SỬA LỖI #11); trang certificate public nhưng chỉ hiển thị tên + khóa học — không hiển thị email/địa chỉ |

### 4.3 Bảo mật server & vận hành

| # | Rủi ro | Cách xử lý |
|---|---|---|
| 16 | Phình DB không kiểm soát | Activity: giới hạn 90 ngày + script cleanup; Note: giới hạn plan free; Review: unique index |
| 17 | N+1 query làm chậm | Progress: 1 aggregate pipeline `getTotalVideosForCourse()` (SỬA LỖI #9); Review: 1 aggregate tính avg |
| 18 | Cookie bị đánh cắp khi xem video | Giữ nguyên httponly + secure (production) như hiện tại; không đặt thêm cookie |

---

## 5. 🎨 Kế Hoạch UI/UX Chi Tiết

### 5.1 Các view mới cần tạo

| View | Mô tả | Route |
|---|---|---|
| `src/resources/views/me/watch-history.hbs` | Trang lịch sử xem, group theo ngày | `GET /me/watch-history` |
| `src/resources/views/certificates/show.hbs` | Trang chứng chỉ public, printable | `GET /certificates/:certificateId` |
| `src/resources/views/partials/progress-bar.hbs` | Partial thanh tiến độ tái sử dụng | — |
| `src/resources/views/partials/review-section.hbs` | Partial section đánh giá | — |
| `src/resources/views/partials/notes-panel.hbs` | Partial panel ghi chú | — |

### 5.2 Các view hiện tại cần sửa

| View | Thay đổi |
|---|---|
| `src/resources/views/courses/show.hbs` | Thêm: nút enroll, progress bar, nút complete video, section review, panel notes, hiển thị rating trung bình |
| `src/resources/views/partials/header.hbs` | Thêm link "Lịch sử xem" vào dropdown user |
| `src/resources/views/courses/create.hbs` / `edit.hbs` | Thêm checkbox "Cấp chứng chỉ khi hoàn thành" (field `certificate: Boolean`) |
| `src/resources/views/me/my-course.hbs` | Hiển thị % tiến độ cho từng khóa học + nút "Tiếp tục học" |

### 5.3 Thiết kế tương tác (UX)

**Luồng học viên hoàn thành khóa học:**

```
1. User mở khóa học → chưa enroll → thấy nút [Đăng ký khóa học] màu xanh nổi bật
2. User enroll → nút biến thành [Đã đăng ký] (disabled), progress hiện 0%
3. User bấm video → iframe YouTube load → gọi POST /api/videos/:id/watch (ghim lịch sử)
4. User xem xong → bấm [✔ Đánh dấu đã hoàn thành] → checkbox xanh trong sidebar, progress tăng
5. (Tùy chọn) User mở ghi chú → viết note riêng cho từng video
6. User hoàn thành video cuối → banner 🎉 + nút [Nhận chứng chỉ] → trang certificate
7. User có thể đánh giá khóa học (rating sao + bình luận) sau khi enroll
```

**Trạng thái nút "Đánh dấu hoàn thành":**

| Trạng thái | UI |
|---|---|
| Chưa enroll | Ẩn nút, hiện nút [Đăng ký học] (nếu owner → hiện nút luôn) |
| Đã enroll, chưa xem | `[○ Đánh dấu đã hoàn thành]` (outline) |
| Đã hoàn thành video này | `[● Đã hoàn thành]` (filled + check, disabled) |
| Đang gửi request | spinner + disabled (theo mẫu `setLoading()` ở manage.hbs) |
| Lỗi mạng | toast đỏ + revert trạng thái |

**Toast feedback** — thống nhất dùng Bootstrap toast (đã có pattern ở `manage.hbs`), không dùng `alert()`.

### 5.4 Responsive

- **Mobile:** progress bar thu gọn thành "3/12 video"; ghi chú chuyển thành drawer từ dưới; rating stars kích thước lớn hơn (touch target 44px).
- **Desktop:** panel ghi chú 2 cột (trái: video, phải: note); certificate dùng layout A4.

### 5.5 Khả năng truy cập (A11y)

- Nút "Đánh dấu hoàn thành" có `aria-pressed="true|false"`.
- Rating stars: dùng `<button aria-label="Đánh giá 4 sao">` thay vì span tĩnh.
- Progress bar: `<div role="progressbar" aria-valuenow="60" aria-valuemin="0" aria-valuemax="100">`.
- Trái ngược với `prefers-reduced-motion` — đã có block ở cuối `app.scss`.

---

## 6. ⚙️ Các Vấn Đề Kỹ Thuật Khác

### 6.1 Migration dữ liệu

**Không cần migration dữ liệu có sẵn** — các collection mới (Enrollment, Note, Review, Certificate, Activity) hoàn toàn độc lập với dữ liệu hiện có.

Chỉ cần sửa nhẹ:
- `Course` → thêm field `certificate: { type: Boolean, default: false }` (cho phép chứng chỉ)
- `User` → không cần sửa (plan đã có, chỉ thêm logic đọc)
- `routes/index.js` → đăng ký router mới

### 6.2 Idempotency, Atomicity & Upsert Options — QUY TẮC CHUNG BẮT BUỘC

> 🔧 **BẢN 2.1 QUY ĐỊNH CHUNG:** MỌI lệnh `findOneAndUpdate` với `upsert: true` trong toàn bộ kế hoạch **BẮT BUỘC** kèm:
> - `setDefaultsOnInsert: true` — đảm bảo default field được set khi INSERT mới.
> - `context: 'query'` — đảm bảo validator (`min`/`max`/`required`) hoạt động đúng trên lệnh upsert (Mongoose không chạy validator theo context mặc định khi upsert).
> - `runValidators: true` (đã có trong các ví dụ).
>
> **Danh sách đầy đủ các lệnh upsert trong kế hoạch:**
>
> | Vị trí | Model | Options bắt buộc |
> |---|---|---|
> | `enroll()` — mục 6.2 (bên dưới) | `Enrollment` | `new: true, upsert: true, setDefaultsOnInsert: true` |
> | `completeVideo()` owner — mục 3.1.2 | `Enrollment` | `new: true, upsert: true, setDefaultsOnInsert: true` |
> | `store()` review — mục 3.3.2 | `CourseReview` | `new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, context: 'query'` |
>
> ⚠️ Nếu bỏ sót `setDefaultsOnInsert: true` trên `Enrollment` upsert: `status`/`completedVideoIds` sẽ KHÔNG được set khi insert → document thiếu field bắt buộc → lỗi runtime. Nếu bỏ sót `context: 'query'` trên `CourseReview`: validator `min: 1, max: 5` KHÔNG chạy khi upsert → rating 0 hoặc 6 có thể được lưu.

- **Enrollment + create** → dùng `findOneAndUpdate` với `upsert: true` (SỬA LỖI #8 — tránh phải try/catch lỗi trùng key 11000). **Đồng thời kiểm tra course tồn tại trước** (Vấn đề E mục 9.2):
  ```js
  // POST /api/courses/:courseId/enroll
  async enroll(req, res, next) {
      // 🔒 Check course tồn tại trước (Vấn đề E mục 9.2)
      const courseId = req.params.courseId;
      if (!mongoose.isValidObjectId(courseId)) {
          return res.status(400).json({ error: 'Course ID không hợp lệ' });
      }
      const courseObjectId = new mongoose.Types.ObjectId(courseId);
      const course = await Course.findById(courseObjectId);
      if (!course) {
          return res.status(404).json({ error: 'Khóa học không tồn tại' });
      }

      // 🔒 BẢN 2.2 — Check quyền enroll theo course.isPublic + roadmap.visibility:
      // - Course public (isPublic: true) → ai cũng enroll được.
      // - Course private (isPublic: false) → CHỈ owner mới tự enroll được; non-owner trả 403.
      // - Course thuộc Roadmap có visibility 'private' hoặc 'draft' → coi như private:
      //   chỉ owner course (hoặc owner roadmap) mới enroll được; non-owner trả 403.
      const isOwner = course.createdBy && course.createdBy.equals(req.user.id);

      let roadmapRestricts = false;
      if (course.roadmapId) {
          const roadmap = await Roadmap.findById(course.roadmapId);
          if (roadmap && roadmap.visibility && roadmap.visibility !== 'public') {
              roadmapRestricts = true;
          }
      }

      if ((!course.isPublic || roadmapRestricts) && !isOwner) {
          return res.status(403).json({ error: 'Bạn không có quyền đăng ký khóa học này' });
      }

      // Upsert + setDefaultsOnInsert (BẢN 2.1 QUY ĐỊNH CHUNG mục 6.2)
      const enrollment = await Enrollment.findOneAndUpdate(
          { userId: req.user.id, courseId: courseObjectId },
          { $setOnInsert: { status: 'active', completedVideoIds: [] } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      res.status(201).json({ enrollment: mongooseToObject(enrollment) });
  }
  ```
- **Certificate issue** → race condition giữa 2 request complete video cuối cùng → unique index bắt được code 11000 → trả bản đã tồn tại.
- Nếu cần nghiêm ngặt hơn (2 collection ghi cùng lúc), dùng **MongoDB session transaction**:
  ```js
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
      await enrollment.save({ session });
      await certificate.create([...], { session });
      await session.commitTransaction();
  } catch (err) {
      await session.abortTransaction();
      throw err;
  } finally {
      session.endSession();
  }
  ```
  Tuy nhiên với quy mô hiện tại, transaction **chưa cần** — việc ghi activity lỗi không nên hủy việc mark completed (giữ log-lỗi riêng giống pattern cache playlist đã có).

### 6.3 Performance

| Vấn đề | Giải pháp |
|---|---|
| Tính % tiến độ mỗi request render | 1 query `Enrollment.findOne` lấy `completedVideoIds.length`, 1 aggregate `getTotalVideosForCourse()` (SỬA LỖI #9) — hoặc cache `totalVideoCount` trên Course |
| Hiển thị rating trung bình | Cache denormalized: lưu `avgRating` + `reviewCount` trên Course, cập nhật sau mỗi review (đánh đổi: thêm 1 update, giảm 1 aggregate mỗi render) — **khuyến nghị giai đoạn 2** |
| Watch history lớn | Pagination + index `{ userId, createdAt }` |
| Note của video nhiều | Limit 50 note/video/user (hiển thị) — lọc bớt ở query |

### 6.4 Xung đột với tính năng hiện tại

| Tính năng hiện tại | Xung đột | Giải quyết |
|---|---|---|
| Khóa học **chưa có Module/Video** (chỉ có `videoid` cũ) | Không có video để mark completed | Progress tính 0% khi course không có tree; ẩn nút complete; khi course chưa migrate 3 cấp thì coi `videoid` cũ là 1 "video ảo" hoặc disable tính năng (khuyến nghị: **disable cho course không có tree**, hiển thị message "Khóa học này chưa có cấu trúc bài học") |
| User sở hữu khóa học (createdBy) | Owner tự enroll/mark completed chính khóa học của mình? | Cho phép — owner cũng là học viên. **Tách 2 nhánh rõ ràng (BẢN 2.1):** chưa enroll + không phải owner → 403; chưa enroll + là owner → upsert tạo enrollment (SỬA LỖI #5 bản 2.1) |
| Roadmap gộp nhiều khóa học | Chứng chỉ theo course đơn lẻ, roadmap chưa có chứng chỉ riêng | **Giai đoạn 1:** chứng chỉ theo Course. **Giai đoạn 2:** chứng chỉ tổng Roadmap (hoàn thành tất cả course trong roadmap) |
| Course bị soft-delete (thùng rác) | Enrollment/Note/Review tới course đã xóa | Cascade xóa khi `forceDestroy` (xóa cứng); soft-delete thì giữ nguyên nhưng ẩn khỏi UI |
| **Course private** (`isPublic: false`) | User chưa enroll vẫn ghi watch history | Check `course.isPublic` trong `recordWatch()` — private: chỉ owner/enrolled (BẢN 2.1 SỬA — mục 3.5.2) |

### 6.5 Testing

**Thêm test thủ công theo mẫu `test/course-crud.test.js`:**

| Test | Case |
|---|---|
| Enrollment | Enroll khóa học → 200; enroll lần 2 → upsert/trả bản cũ; chưa login → 401/302; enroll course không tồn tại → 404 |
| Progress | Mark complete chưa enroll + không phải owner → **403 (BẢN 2.1)**; mark complete chưa enroll + là owner → auto-enroll + mark thành công (BẢN 2.1); mark complete video của khóa khác → 404/403; mark đủ 100% → status='completed' + certificate được tạo; mark trùng → không tăng mảng; **2 request đồng thời → không mất lần hoàn thành (SỬA LỖI #1)** |
| Note | Tạo khi chưa login → chặn; user B không thấy note user A; note quá 5000 ký tự → 400; **user B sửa/xóa note user A → 404 (SỬA LỖI #4)** |
| Review | Rating 6/0 → 400; 2 review cùng user + course → chỉ 1 bản (upsert); chưa enroll → 403; **upsert default field hoạt động (SỬA LỖI #6)** |
| Certificate | Chưa đủ 100% → không phát; đủ 100% → phát 1 lần (2 request race → 1 bản); trang public không lộ email; **scrape 100 ID liên tiếp → rate limit 429 (SỬA LỖI #11)** |
| Watch history | POST watch → ghi; **course private + chưa enroll + không phải owner → 403 (BẢN 2.1)**; course public + chưa enroll → ghi được (xem thử); 100 request liên tiếp → rate limit 429 |

---

## 7. 📋 Kế Hoạch Triển Khai Theo Giai Đoạn

### Giai đoạn 1 — Nền tảng (ước lượng 2–3 ngày)
- [ ] Tạo model `Enrollment` + route enroll (dùng `findOneAndUpdate upsert` + check course tồn tại — SỬA LỖI #8, Vấn đề E) + UI nút enroll
- [ ] Tạo model `Activity` + route watch-history
- [ ] Sửa `routes/index.js` + `src/index.js` (nếu cần) đăng ký router mới
- [ ] Thêm rate limiters mới vào `middlewares/rateLimit.js` — **theo userId** cho note/review/watch, **theo IP** cho certificate (SỬA LỖI #7, #11)

### Giai đoạn 2 — Progress + Notes (ước lượng 3–4 ngày)
- [ ] `ProgressController` (complete/uncomplete video — dùng `$addToSet`/`$pull` atomic, SỬA LỖI #1, #3; **tách 2 nhánh owner/non-owner**, SỬA LỖI #5 bản 2.1)
- [ ] Helper `getTotalVideosForCourse()` — 1 aggregate pipeline + lọc `deleted` (SỬA LỖI #9, #10)
- [ ] Partial `progress-bar.hbs` + sidebar checkbox hoàn thành
- [ ] Model `Note` + `NoteController` (CRUD — filter `{ _id, userId }` trong CÙNG 1 lệnh, SỬA LỖI #4)
- [ ] File `src/public/js/escape-html.js` dùng chung (SỬA LỖI #12)
- [ ] Partial `notes-panel.hbs` + JS
- [ ] Migration course cũ → 3 cấp (script migrate đã có)

### Giai đoạn 3 — Rating/Review (ước lượng 2 ngày)
- [ ] Model `CourseReview` + `ReviewController` (upsert có `setDefaultsOnInsert` + `context: 'query'`, SỬA LỖI #6; cast ObjectId đúng `new` + `isValidObjectId`, SỬA LỖI #2)
- [ ] Section review UI (stars + comment + list)
- [ ] Hiển thị rating trung bình trên trang khóa học và trang chủ

### Giai đoạn 4 — Certificate (ước lượng 2–3 ngày)
- [ ] `Course.certificate` field + checkbox trong form tạo/sửa course
- [ ] Model `Certificate` + `utils/certificate.js` (issueCertificate)
- [ ] Tích hợp vào `ProgressController` (khi 100% → auto issue)
- [ ] View `certificates/show.hbs` (print CSS) + route public + `certificateLimiter` (SỬA LỖI #11)
- [ ] Thêm field `isPublic: { type: Boolean, default: true }` trên Certificate (BẢN 2.1 — không phá vỡ certificate cũ)

### Giai đoạn 5 — Polish (ước lượng 2 ngày)
- [ ] Toast/loading state thống nhất
- [ ] Responsive mobile
- [ ] A11y (aria-label, role=progressbar)
- [ ] Test thủ công theo danh sách 6.5
- [ ] Script cleanup activity cũ (90 ngày)

> ⏱️ **Tổng ước lượng: 11–14 ngày** cho 1 developer làm full-time. (Xem phản biện mục 9.4 về độ thực tế — điều chỉnh 14–18 ngày.)

---

## 8. 📌 Tóm Tắt Quyết Định Thiết Kế

| Vấn đề | Quyết định | Lý do |
|---|---|---|
| Progress nhúng User hay collection riêng | **Collection `Enrollment` riêng** | Khóa học nhiều, tránh phình User; dễ query lịch sử; khác CourseLit nhưng tốt hơn cho scale |
| Ghi chú có từ CourseLit? | **KHÔNG có** — tự thiết kế | CourseLit không có tính năng này (đã verify) |
| Rating star | **Tự xây** (không dùng thư viện) | Đơn giản, tránh dependency; CourseLit cũng không có rating |
| Watch history dedup hay không? | **Không dedup** cho `video_started` | Watch history cần lịch sử đầy đủ (xem lại nhiều lần); dedup cho `video_completed` |
| Certificate public hay private? | **Public** với ID ngẫu nhiên | Học viên cần chia sẻ lên LinkedIn/Facebook |
| Certificate public + quyền riêng tư (giai đoạn 2) | Thêm `isPublic: Boolean default: true` | Certificate cũ (giai đoạn 1) fallback undefined→true — không phá vỡ; user có thể tự ẩn (BẢN 2.1 XÁC NHẬN) |
| Certificate phát khi nào? | **Server tự phát sau 100%** | Chống giả mạo; theo đúng CourseLit |
| Owner khóa học có enroll? | **Có** — nhưng tách 2 nhánh: non-owner chưa enroll → 403; owner chưa enroll → upsert (BẢN 2.1 SỬA LỖ HỔNG) | Owner cũng là học viên; KHÔNG auto-enroll cho mọi user |
| Course chưa có Module/Video | **Disable tính năng** | Không có gì để đánh dấu hoàn thành |
| Bỏ đánh dấu hoàn thành sau khi đã nhận chứng chỉ | **Giữ chứng chỉ, không thu hồi** | Chứng chỉ là snapshot; tránh phức tạp thu hồi (SỬA LỖI #3) |
| Rate limit cho route đã qua `requireAuth` | **Theo `userId`** | Tránh false-positive NAT chung, tránh né bằng đổi IP (SỬA LỖI #7) |
| Ghi watch history vào course private | **Chặn** — chỉ owner/enrolled | Course private không được ghi watch bởi người ngoài (BẢN 2.1 SỬA — không phải chủ đích, là sót) |
| Upsert options | **BẮT BUỘC** `setDefaultsOnInsert: true` (+ `context: 'query'` khi có validator) cho MỌI lệnh upsert | Đảm bảo default field + validator hoạt động đúng (BẢN 2.1 QUY ĐỊNH — mục 6.2) |

---

## 9. 🔍 Phản Biện Toàn Bộ Kế Hoạch (Bản Cập Nhật)

> Mục này là kết quả tự đọc lại toàn bộ kế hoạch với vai trò người review độc lập — **không chỉ sửa những gì đã được chỉ ra**, mà còn tìm thêm các vấn đề tiềm ẩn khác.

### 9.1 Còn thao tác ghi (write) nào không atomic mà có thể đã bỏ sót?

**Đã rà soát toàn bộ các thao tác ghi trong tài liệu:**

| Thao tác ghi | Atomic? | Ghi chú |
|---|---|---|
| `completeVideo()` — thêm videoId | ✅ Đã sửa | `findOneAndUpdate` + `$addToSet` (SỬA LỖI #1) |
| `uncompleteVideo()` — bỏ videoId | ✅ Đã sửa | `findOneAndUpdate` + `$pull` (SỬA LỖI #3) |
| `enroll()` — tạo enrollment | ✅ Đã sửa | `findOneAndUpdate` + `upsert` + `setDefaultsOnInsert` (SỬA LỖI #8, BẢN 2.1) |
| `completeVideo()` — upsert enrollment cho owner | ✅ Đã sửa | `findOneAndUpdate` + `upsert` + `setDefaultsOnInsert` (BẢN 2.1 — tách nhánh owner/non-owner) |
| `CourseReview` upsert | ✅ Đã sửa | `findOneAndUpdate` + `upsert` + `setDefaultsOnInsert` + `context: 'query'` (SỬA LỖI #6) |
| `issueCertificate()` | ✅ Đã sửa | Unique index + catch 11000 |
| `Note.create()` | ✅ An toàn | Không có unique constraint cần race — mỗi note là 1 document độc lập |
| `Note.update/delete` | ✅ Đã sửa | `findOneAndUpdate`/`findOneAndDelete` với filter `{ _id, userId }` (SỬA LỖI #4) |
| `Activity.create()` (watch) | ✅ An toàn | Không có unique constraint — mỗi activity là 1 document độc lập |
| `Enrollment` set `status: 'completed'` | ✅ Đã sửa | `findOneAndUpdate` với filter `status: { $ne: 'completed' }` — tránh ghi đè `completedAt` |

**⚠️ VẤN ĐỀ MỚI PHÁT HIỆN (chưa được chỉ ra trước đó):**

**Vấn đề A — `issueCertificate()` không atomic hoàn toàn:**
- Đoạn `Certificate.findOne({ userId, courseId })` rồi `Certificate.create()` vẫn có **khoảng trống race** — 2 request đồng thời đều pass `findOne` (cả 2 thấy chưa có) rồi cùng `create()`. Unique index sẽ bắt 1 trong 2 lỗi 11000 → catch → `findOne` lại → OK. **Nhưng** nếu `Activity.create()` (ghi `certificate_issued`) bị lỗi sau khi Certificate đã tạo, thì certificate tồn tại nhưng không có activity log.
- **Cách xử lý:** chấp nhận — activity log là phụ, không ảnh hưởng tính đúng đắn của certificate. Nếu muốn nghiêm ngặt, dùng transaction (đã nêu ở 6.2) nhưng **không khuyến nghị** cho quy mô hiện tại.

**Vấn đề B — `getTotalVideosForCourse()` chạy 2 lần trong `completeVideo()`:**
- Trong `completeVideo()`, `getTotalVideosForCourse()` được gọi 1 lần để tính `totalVideos`. Nhưng nếu `uncompleteVideo()` cũng gọi lại → 2 lần aggregate. **Không phải bug** nhưng tốn query.
- **Cách xử lý:** chấp nhận — aggregate pipeline nhẹ, chạy 2 lần không đáng kể. Nếu cần tối ưu, cache `totalVideoCount` trên Course (đã nêu ở 6.3).

**Vấn đề C — `recordWatch()` ban đầu không check quyền xem course private (SÓT):**
- Bản 2.0 xác nhận "giữ nguyên — cho phép xem thử". Nhưng đây là **sót**, không phải chủ đích: user chưa enroll vẫn ghi được watch history vào course **private/draft** (`isPublic: false`). **Đã sửa ở bản 2.1** (mục 3.5.2): check `course.isPublic` — private: chỉ owner/enrolled; public: cho phép xem thử.

### 9.2 Còn route nào thiếu kiểm tra ownership tường minh trong pseudo-code không?

**Đã rà soát toàn bộ route mới:**

| Route | Ownership check | Ghi chú |
|---|---|---|
| `POST /api/courses/:courseId/enroll` | ✅ Check course tồn tại + user đăng nhập (BẢN 2.1 — check course tồn tại) | Không cần check ownership — ai cũng enroll được |
| `POST /api/videos/:videoId/complete` | ✅ **Tách 2 nhánh:** chưa enroll + không phải owner → 403; chưa enroll + là owner → upsert (BẢN 2.1 — SỬA LỖ HỔNG #5) | SỬA LỖI #5 |
| `DELETE /api/videos/:videoId/complete` | ✅ Check enrollment | SỬA LỖI #3 |
| `GET /api/courses/:courseId/progress` | ✅ Check enrollment + course tồn tại (Vấn đề D) | Chỉ user đã enroll xem được progress của mình |
| `POST /api/videos/:videoId/notes` | ✅ Check video tồn tại | Note luôn gắn `userId: req.user.id` |
| `GET /api/videos/:videoId/notes` | ✅ Check video tồn tại | Chỉ trả note của chính user |
| `PUT /api/notes/:id` | ✅ **Filter `{ _id, userId }` trong CÙNG 1 lệnh** | SỬA LỖI #4 |
| `DELETE /api/notes/:id` | ✅ **Filter `{ _id, userId }` trong CÙNG 1 lệnh** | SỬA LỖI #4 |
| `POST /api/courses/:courseId/reviews` | ✅ Check enrollment + course tồn tại | Chỉ user đã enroll review được |
| `GET /api/courses/:courseId/reviews` | ✅ Không cần auth | Review là public |
| `GET /api/courses/:courseId/rating` | ✅ Không cần auth | Rating là public |
| `POST /api/videos/:videoId/watch` | ✅ Check video/module/course tồn tại + **check course.isPublic** (BẢN 2.1 — SỬA SÓT) | Private: chỉ owner/enrolled; public: xem thử |
| `GET /me/watch-history` | ✅ `requireAuth` + query `userId: req.user.id` | Không nhận userId từ client |
| `GET /certificates/:certificateId` | ✅ Public + rate limit + check isPublic giai đoạn 2 | SỬA LỖI #11 |

**⚠️ VẤN ĐỀ MỚI PHÁT HIỆN (chưa được chỉ ra trước đó):**

**Vấn đề D — `GET /api/courses/:courseId/progress` thiếu check course tồn tại:**
- Pseudo-code hiện tại chỉ check enrollment — nếu course không tồn tại nhưng enrollment tồn tại (dữ liệu lỗi), sẽ trả progress của course không tồn tại.
- **Cách xử lý:** thêm check `Course.findById(courseId)` trước — nếu không tồn tại trả 404. **Bổ sung vào kế hoạch.**

**Vấn đề E — `POST /api/courses/:courseId/enroll` thiếu check course tồn tại:**
- Pseudo-code hiện tại upsert enrollment mà không check course tồn tại → có thể tạo enrollment cho course không tồn tại.
- **Cách xử lý:** thêm check `Course.findById(courseId)` trước — nếu không tồn tại trả 404. **Đã bổ sung ở mục 6.2 (BẢN 2.1).**

### 9.3 Giả định "1 developer, 11–14 ngày" có thực tế không?

**Đánh giá: HƠI LẠC QUAN, đặc biệt ở các phần sau:**

| Giai đoạn | Ước lượng | Rủi ro trễ tiến độ | Đánh giá |
|---|---|---|---|
| GĐ 1 — Nền tảng | 2–3 ngày | Thấp — model + route đơn giản | ✅ Hợp lý |
| GĐ 2 — Progress + Notes | 3–4 ngày | **CAO** — đây là phần phức tạp nhất: atomic update, aggregate pipeline, UI progress bar, panel notes + JS AJAX, escapeHtml, tách nhánh owner/non-owner | ⚠️ Có thể trễ 1–2 ngày |
| GĐ 3 — Rating/Review | 2 ngày | Trung bình — upsert + validator + UI stars | ⚠️ Có thể trễ 0.5–1 ngày |
| GĐ 4 — Certificate | 2–3 ngày | Trung bình — issue workflow + template + print CSS + isPublic | ⚠️ Có thể trễ 0.5–1 ngày |
| GĐ 5 — Polish | 2 ngày | **CAO** — test thủ công 6 nhóm + responsive + A11y thường mất nhiều thời gian hơn dự kiến | ⚠️ Có thể trễ 1–2 ngày |

**Kết luận:** Ước lượng thực tế hơn là **14–18 ngày** (thay vì 11–14). Phần rủi ro trễ tiến độ nhất là **GĐ 2 (Progress + Notes)** — vì nó đụng chạm nhiều nhất vào luồng hiện tại (sửa `CourseController.show`, thêm JS phức tạp, atomic update) và **GĐ 5 (Polish)** — vì test thủ công + responsive + A11y thường bị đánh giá thấp.

### 9.4 Có quyết định thiết kế nào ở mục 8 mà tôi — với vai trò người review độc lập — không đồng ý hoặc muốn đề xuất khác?

**Quyết định 1 — "Progress nhúng User hay collection riêng → Collection `Enrollment` riêng":**
- **Đồng ý** với quyết định này. CourseLit nhúng vào User vì họ có ít khóa học/user hơn. V-Connect hướng tới UGC (nhiều khóa học) nên collection riêng là đúng.
- **Tuy nhiên**, cần lưu ý: collection riêng đồng nghĩa với **nhiều query hơn** (join Enrollment + Course + Module + Video). Cần đảm bảo index đầy đủ.

**Quyết định 2 — "Watch history không dedup cho `video_started`":**
- **Đồng ý** — watch history cần lịch sử đầy đủ.
- **Tuy nhiên**, cần lưu ý: không dedup đồng nghĩa với **phình DB nhanh** — 1 user xem 10 video/ngày × 365 ngày = 3650 activity/năm. Với 1000 user = 3.65 triệu activity/năm. **Cần script cleanup 90 ngày** (đã nêu) là bắt buộc, không phải tùy chọn.

**Quyết định 3 — "Certificate public với ID ngẫu nhiên":**
- **Đồng ý** — public giúp chia sẻ, ID ngẫu nhiên chống quét.
- **BẢN 2.1 XÁC NHẬN:** "public" nghĩa là **bất kỳ ai có link đều xem được** — kể cả tên người hoàn thành. Giai đoạn 2 thêm field `isPublic: Boolean, default: true` để user có thể tự ẩn. **Mặc định `true` là bắt buộc** để KHÔNG phá vỡ certificate đã cấp ở giai đoạn 1 (certificate cũ không có field `isPublic` → `undefined` → fallback coi là public). Nếu mặc định `false` sẽ làm certificate cũ bỗng dưng ẩn — phá vỡ link chia sẻ.

**Quyết định 4 — "Owner khóa học auto-enroll":**
- **Đồng ý** — owner cũng là học viên.
- **NHƯNG BẢN 2.1 SỬA LỖ HỔNG:** Bản 2.0 upsert vô tình auto-enroll cho **MỌI user** — vô hiệu hoá yêu cầu "phải enroll trước". Phải tách 2 nhánh: non-owner chưa enroll → 403; owner chưa enroll → upsert.

**Quyết định 5 — "Bỏ đánh dấu hoàn thành → giữ chứng chỉ, không thu hồi":**
- **Đồng ý** — snapshot là hợp lý.
- **Tuy nhiên**, cần lưu ý: nếu user bỏ tick 1 video rồi **hoàn thành lại** → `issueCertificate()` sẽ trả certificate cũ (idempotent) — **không tạo mới**. Điều này đúng (không phát trùng) nhưng user có thể thắc mắc "tại sao chứng chỉ không đổi ngày". **Đề xuất:** chấp nhận — chứng chỉ là snapshot lần đầu hoàn thành.

### 9.5 Phase 1–2 (Enrollment, Activity, Progress, Note) có phụ thuộc ẩn nào vào Phase 3–4 (Review, Certificate) không?

**Phân tích phụ thuộc:**

| Phase 1–2 | Phụ thuộc Phase 3–4? | Chi tiết |
|---|---|---|
| `Enrollment` model | ❌ Không | Độc lập hoàn toàn |
| `Activity` model | ❌ Không | Độc lập hoàn toàn |
| `Enroll` route | ❌ Không | Chỉ cần Course + User |
| `completeVideo()` | ⚠️ **CÓ phụ thuộc ẩn** | Gọi `issueCertificate()` khi 100% — nhưng `issueCertificate()` nằm ở Phase 4. **Giải pháp:** tạo `utils/certificate.js` (helper) ở Phase 2, chỉ implement `issueCertificate()` đơn giản (tạo Certificate + Activity) — Phase 4 chỉ thêm template + UI. |
| `Note` model + CRUD | ❌ Không | Độc lập hoàn toàn |
| `watch-history` route | ❌ Không | Chỉ cần Activity |
| `getTotalVideosForCourse()` | ❌ Không | Chỉ cần Module + Video |

**Kết luận:**
- **Phase 1–2 có thể tách độc lập được** với Phase 3–4, **ngoại trừ 1 phụ thuộc ẩn**: `completeVideo()` gọi `issueCertificate()` khi 100%.
- **Cách xử lý:** tạo `utils/certificate.js` ở **Phase 2** (chỉ implement phần tạo Certificate + Activity — ~20 dòng), Phase 4 chỉ thêm `CertificateTemplate` + UI trang chứng chỉ. Như vậy Phase 1–2 vẫn chạy được độc lập, Phase 4 chỉ là "mở rộng" không phải "bắt buộc".
- **Lưu ý:** nếu Phase 2 chưa có `Certificate` model, `completeVideo()` phải **bọc `issueCertificate()` trong try/catch** (hoặc check `course.certificate === true` trước khi gọi) — tránh crash khi model chưa tồn tại.

### 9.6 Tổng kết phản biện — các vấn đề mới phát hiện cần bổ sung vào kế hoạch

| # | Vấn đề mới | Mức độ | Cách xử lý |
|---|---|---|---|
| A | `issueCertificate()` không atomic hoàn toàn (activity log có thể thiếu) | Thấp | Chấp nhận — activity là phụ; transaction không cần thiết |
| B | `getTotalVideosForCourse()` chạy 2 lần (complete + uncomplete) | Thấp | Chấp nhận — pipeline nhẹ; cache nếu cần |
| C | `recordWatch()` **SÓT check quyền xem course private** (bản 2.0 xác nhận sai là chủ đích) | **CAO** | **Đã sửa bản 2.1** — check `course.isPublic`: private → chỉ owner/enrolled; public → cho phép (mục 3.5.2) |
| D | `GET /api/courses/:courseId/progress` thiếu check course tồn tại | Trung bình | **Bổ sung** — check `Course.findById` trước, trả 404 nếu không tồn tại |
| E | `POST /api/courses/:courseId/enroll` thiếu check course tồn tại | Trung bình | **Đã bổ sung mục 6.2 (BẢN 2.1)** — check `Course.findById` trước, trả 404 nếu không tồn tại |
| F | Certificate public lộ tên người hoàn thành | Thấp | **Bổ sung giai đoạn 2** — thêm field `isPublic: Boolean, default: true` (BẢN 2.1 XÁC NHẬN: mặc định true để không phá vỡ certificate cũ) |
| G | Ước lượng 11–14 ngày hơi lạc quan | Trung bình | **Điều chỉnh** — thực tế 14–18 ngày; rủi ro trễ nhất ở GĐ 2 và GĐ 5 |
| H | **LỖ HỔNG BẢN 2.0:** upsert auto-enroll vô hiệu hoá check enrollment cho MỌI user | **NGHIÊM TRỌNG** | **Đã sửa bản 2.1** — tách 2 nhánh: non-owner chưa enroll → 403; owner chưa enroll → upsert (mục 3.1.2) |
| I | **BẢN 2.2:** `enroll()` thiếu check `course.isPublic` + `roadmap.visibility` — user có thể enroll course private/roadmap private | **CAO** | **Đã sửa bản 2.2** — check `course.isPublic` + `roadmap.visibility`: private → chỉ owner mới enroll được; non-owner trả 403 (mục 6.2) |
| J | **BẢN 2.2:** `getTotalVideosForCourse()` chỉ lọc `deleted` của Video, chưa lọc `module.deleted` — course có thể không bao giờ đạt 100% nếu module bị soft-delete | **CAO** | **Đã sửa bản 2.2** — thêm `'module.deleted': { $ne: true }` vào `$match` (mục 3.1.2) |
| K | **BẢN 2.2:** `progressPercent` chia 0 khi `totalVideos = 0` → NaN lọt vào JSON response | **TRUNG BÌNH** | **Đã sửa bản 2.2** — guard `totalVideos > 0 ? Math.round(...) : 0` tại mọi nơi tính % (completeVideo, uncompleteVideo, CourseController.show — mục 3.1.2, 3.1.3) |

---

*Tài liệu kết thúc. Đây là kế hoạch chi tiết phiên bản 2.2 — đã vá 12 lỗi/rủi ro (bản 2.0) + 2 lỗ hổng bảo mật (bản 2.1) + 3 lỗi mới (bản 2.2: enroll check isPublic+roadmap, getTotalVideos lọc module.deleted, guard chia 0). Chưa có code thực thi nào được áp dụng vào dự án. Khi bạn duyệt kế hoạch, hãy chuyển sang Act Mode để triển khai từng giai đoạn.*
