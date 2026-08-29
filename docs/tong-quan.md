# Tổng Quan Dự Án V-Connect

> Tài liệu tổng quan toàn diện về kiến trúc, cấu trúc và chức năng của dự án V-Connect. Được thiết kế để nạp nhanh cho LLMs và developer mới.

---

## 1. Giới Thiệu Chung

**V-Connect** là một nền tảng học trực tuyến (Learning Management System) dựa trên Node.js, cho phép người dùng tạo và quản lý khóa học, lộ trình học tập, đăng ký học tập, theo dõi tiến độ, viết ghi chú, đánh giá và nhận chứng chỉ hoàn thành. Nền tảng tích hợp sẵn nội dung từ YouTube thông qua Data API v3 và oEmbed.

- **Ngôn ngữ chính:** JavaScript (Node.js)
- **Kiến trúc:** MVC (Model – View – Controller) với Express.js
- **Cơ sở dữ liệu:** MongoDB (thông qua Mongoose ODM)
- **Template engine:** Handlebars (express-handlebars)
- **Frontend:** HTML + CSS (Bootstrap 5 + SCSS tùy biến) + jQuery + vanilla JS
- **Xác thực:** JWT (access token ngắn hạn) + Refresh token (lưu trong DB) + Cookie httpOnly
- **Bảo mật:** CSRF protection, CORS whitelist, Helmet (CSP), rate limiting, bcrypt hashing

---

## 2. Cấu Trúc Thư Mục Dự Án

```
V-Connect/
├── src/
│   ├── index.js                          # Entry point — cấu hình Express, middleware, route, error handler
│   ├── config/
│   │   └── db/
│   │       └── index.js                  # Kết nối MongoDB qua Mongoose
│   ├── app/
│   │   ├── controllers/                  # Các controller xử lý logic nghiệp vụ
│   │   ├── middlewares/                  # Middleware: auth, CSRF, CORS, rate-limit, ownership
│   │   └── models/                       # Các Mongoose Schema (định nghĩa database)
│   ├── routes/                           # Định nghĩa các route URL
│   ├── utils/                            # Tiện ích chung: token, certificate, progress, youtube, validators, slugify, mongoose
│   ├── public/                           # Tài nguyên tĩnh (CSS, JS, hình ảnh)
│   │   ├── css/                          # CSS biên dịch từ SCSS
│   │   ├── js/                           # JavaScript frontend
│   │   └── img/                          # Hình ảnh
│   └── resources/
│       ├── scss/                         # SCSS nguồn (biên dịch sang CSS)
│       └── views/                        # Template Handlebars (.hbs)
├── docs/                                 # Tài liệu dự án
├── scripts/                              # Script tiện ích: tạo admin, migration, test
├── test/                                 # Test tự động
├── .env.example                          # Mẫu biến môi trường
├── nodemon.json                          # Cấu hình nodemon
└── package.json                          # Quản lý dependency và script
```

---

## 3. Các Thư Viện (Dependencies)

### 3.1. Dependencies chính (runtime)

| Thư viện | Phiên bản | Mô tả |
|---|---|---|
| **express** | ^5.2.1 | Framework web nền tảng |
| **mongoose** | ^9.9.1 | ODM cho MongoDB |
| **mongoose-delete** | ^1.0.7 | Plugin soft-delete cho Mongoose |
| **express-handlebars** | ^9.0.1 | Template engine Handlebars |
| **jsonwebtoken** | ^9.0.3 | Tạo & xác thực JWT |
| **bcryptjs** | ^3.0.3 | Mã hóa mật khẩu |
| **cookie-parser** | ^1.4.7 | Đọc/ghi cookie |
| **cors** | ^2.8.6 | Cấu hình CORS |
| **csrf-csrf** | ^4.0.3 | Bảo vệ CSRF (double-submit cookie) |
| **helmet** | ^8.3.0 | Bảo mật HTTP headers (CSP, v.v.) |
| **method-override** | ^3.0.0 | Hỗ trợ method PUT/DELETE qua query `_method` |
| **express-rate-limit** | ^8.6.2 | Giới hạn tần suất request |
| **bootstrap** | ^5.3.8 | Framework CSS |

### 3.2. Dev dependencies

| Thư viện | Phiên bản | Mô tả |
|---|---|---|
| **nodemon** | ^3.1.14 | Tự động restart server khi code thay đổi |
| **morgan** | ^1.11.0 | HTTP request logger |
| **sass** | ^1.101.7 | Biên dịch SCSS → CSS |
| **prettier** | ^3.9.6 | Định dạng code |
| **husky** | ^9.1.7 | Git hooks |
| **lint-staged** | ^17.3.0 | Chạy prettier trên staged files |
| **axios** | ^1.19.0 | HTTP client (dùng trong test) |
| **axios-cookiejar-support** | ^7.0.0 | Quản lý cookie trong test |
| **tough-cookie** | ^6.0.2 | Cookie jar cho test |

### 3.3. Script npm

| Script | Mô tả |
|---|---|
| `npm start` | Chạy server ở chế độ dev (nodemon) |
| `npm run watch` | Biên dịch SCSS → CSS liên tục |
| `npm run create-admin` | Tạo tài khoản admin đầu tiên |
| `npm run migrate-roadmap-v2` | Migration dữ liệu roadmap v2 |
| `npm run beautiful` | Chạy lint-staged (prettier) |

---

## 4. Cơ Sở Dữ Liệu (MongoDB)

Dự án sử dụng **MongoDB** thông qua **Mongoose ODM**. Kết nối được cấu hình trong `src/config/db/index.js` với URI từ biến môi trường `MONGODB_URI`.

### 4.1. Các Collection (Model)

#### 4.1.1. **User** (`src/app/models/User.js`)
Lưu thông tin người dùng đăng ký/đăng nhập.

| Trường | Kiểu | Mô tả |
|---|---|---|
| `name` | String | Họ tên (bắt buộc, trim) |
| `username` | String | Tên đăng nhập (duy nhất, lowercase, ≥3 ký tự) |
| `email` | String | Email (duy nhất, validate định dạng) |
| `password` | String | Mật khẩu (được hash bằng bcrypt, `select: false`) |
| `role` | String | Vai trò: `user` hoặc `admin` (mặc định `user`) |
| `plan` | String | Gói người dùng: `free` hoặc `pro` (mặc định `free`) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điểm:**
- Mật khẩu được tự động hash bằng bcrypt (salt 12 vòng) trước khi lưu thông qua middleware `pre('save')`.
- Có phương thức `comparePassword()` để so sánh mật khẩu.
- Sử dụng plugin `mongoose-delete` (soft-delete) — xóa mềm, giữ lại `deletedAt`.

#### 4.1.2. **Course** (`src/app/models/Course.js`)
Lưu thông tin khóa học.

| Trường | Kiểu | Mô tả |
|---|---|---|
| `name` | String | Tên khóa học (bắt buộc, ≤255 ký tự) |
| `description` | String | Mô tả khóa học |
| `image` | String | URL ảnh thumbnail (tự động sinh từ YouTube) |
| `videoid` | String | YouTube video ID (bắt buộc, 11 ký tự) |
| `level` | String | Trình độ: Cơ bản / Trung bình / Nâng cao |
| `slug` | String | Đường dẫn thân thiện (duy nhất, tự động sinh) |
| `createdBy` | ObjectId → User | Người tạo khóa học |
| `roadmapId` | ObjectId → Roadmap | Lộ trình gắn liền (nếu có) |
| `roadmapOrder` | Number | Thứ tự trong lộ trình |
| `isPublic` | Boolean | Công khai (mặc định `true`) |
| `certificate` | Boolean | Cấp chứng chỉ khi hoàn thành 100% (mặc định `false`) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điểm:**
- Slug tự động sinh trước khi lưu (`pre('save')`, `pre('findOneAndUpdate')`, `pre('updateOne')`) bằng hàm `generateUniqueSlug()`.
- Sử dụng plugin `mongoose-delete` (soft-delete).
- Có index phứ hợp `{ roadmapId: 1, roadmapOrder: 1, createdAt: 1 }`.

#### 4.1.3. **Module** (`src/app/models/Module.js`)
Đơn vị chứa video trong khóa học (cây thứ bật Module → Video).

| Trường | Kiểu | Mô tả |
|---|---|---|
| `name` | String | Tên module (bắt buộc, ≤255 ký tự) |
| `courseId` | ObjectId → Course | Khóa học chứa (bắt buộc, có index) |
| `order` | Number | Thứ tự sắp xếp (mặc định 0) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điểm:**
- Không có `createdBy` riêng — quyền sở hữu được truy ngược lên Course cha.
- Không sử dụng soft-delete (xóa cứng).

#### 4.1.4. **Video** (`src/app/models/Video.js`)
Video học (liên kết YouTube).

| Trường | Kiểu | Mô tả |
|---|---|---|
| `youtubeId` | String | YouTube video ID (bắt buộc) |
| `moduleId` | ObjectId → Module | Module chứa (bắt buộc, có index) |
| `title` | String | Tiêu đề video (bắt buộc) |
| `order` | Number | Thứ tự sắp xếp trong module (mặc định 0) |
| `duration` | String | Thời lượng video |
| `aiSubtitles` | String | Trạng thái phụ đề AI (mặc định `null`) |
| `aiDubbing` | String | Trạng thái dịch âm AI (mặc định `null`) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điểm:**
- Không có `createdBy` riêng — quyền sở hữu được truy ngược lên Course cha qua Module.
- Không sử dụng soft-delete (xóa cứng).

#### 4.1.5. **Enrollment** (`src/app/models/Enrollment.js`)
Ghi nhận việc người dùng đăng ký khóa học.

| Trường | Kiểu | Mô tả |
|---|---|---|
| `userId` | ObjectId → User | Người đăng ký (bắt buộc, có index) |
| `courseId` | ObjectId → Course | Khóa học (bắt buộc, có index) |
| `status` | String | Trạng thái: `active` hoặc `completed` (mặc định `active`) |
| `completedVideoIds` | [ObjectId] | Danh sách ID video đã hoàn thành |
| `completedAt` | Date | Thời gian hoàn thành khóa học |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điệc:**
- Unique index `{ userId: 1, courseId: 1 }` — 1 user chỉ enroll 1 lần/1 khóa học.
- `completedVideoIds` dùng `$addToSet` để tránh trùng lặp.

#### 4.1.6. **CourseReview** (`src/app/models/CourseReview.js`)
Đánh giá và bình luận của người dùng về khóa học.

| Trường | Kiểu | Mô tả |
|---|---|---|
| `userId` | ObjectId → User | Người đánh giá (bắt buộc) |
| `courseId` | ObjectId → Course | Khóa học (bắt buộc, có index) |
| `rating` | Number | Đi số sao 1–5 (bắt buộc) |
| `comment` | String | Bình luận (≤2000 ký tự, mặc định rỗng) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điệc:**
- Unique index `{ userId: 1, courseId: 1 }` — 1 user chỉ đánh giá 1 lần/1 khóa học (upsert).

#### 4.1.7. **Certificate** (`src/app/models/Certificate.js`)
Chứng chỉ hoàn thành khóa học.

| Trường | Kiểu | Mô tả |
|---|---|---|
| `userId` | ObjectId → User | Người nhận (bắt buộc) |
| `courseId` | ObjectId → Course | Khóa học (bắt buộc) |
| `certificateId` | String | Mã chứng chỉ ngẫu nhiên 128-bit (duy nhất, tự động sinh) |
| `isPublic` | Boolean | Công khai chứng chỉ (mặc định `true`) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điệc:**
- Unique index `{ userId: 1, courseId: 1 }` — idempotent (chỉ phát 1 lần/user/khóa).
- `certificateId` sinh ngẫu nhiên bằng `crypto.randomBytes(16)` — không dùng `_id` của Mongo để tránh dự đoán.
- Chứng chỉ chỉ được phát khi user hoàn thành 100% khóa học **và** khóa học có bật `certificate: true`.

#### 4.1.8. **Roadmap** (`src/app/models/Roadmap.js`)
Lộ trình học tập (gom nhóm nhiều khóa học).

| Trường | Kiểu | Mô tả |
|---|---|---|
| `name` | String | Tên lộ trình (bắt buộc, ≤255 ký tự) |
| `description` | String | Mô tả lộ trình |
| `slug` | String | Đường dẫn thân thiện (duy nhất, tự động sinh) |
| `createdBy` | ObjectId → User | Người tạo (bắt buộc) |
| `isPublic` | Boolean | Công khai (mặc định `true`) |
| `visibility` | String | Trạng thái: `public`, `private`, `draft` (mặc định `public`, có index) |
| `category` | String | Danh mục (≤120 ký tự) |
| `difficulty` | String | Độ khó (≤120 ký tự) |
| `coverImage` | String | URL ảnh bìa |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điệm:**
- Slug tự động sinh (giống Course).
- Sử dụng plugin `mongoose-delete` (soft-delete).
- Có index `{ createdBy: 1, visibility: 1, createdAt: -1 }`.

#### 4.1.9. **Note** (`src/app/models/Note.js`)
Ghi chú của người dùng trên từng video.

| Trường | Kiểu | Mô tả |
|---|---|---|
| `userId` | ObjectId → User | Người ghi chú (bắt buộc, có index) |
| `videoId` | ObjectId → Video | Video (bắt buộc, có index) |
| `courseId` | ObjectId → Course | Khóa học chứa video |
| `content` | String | Nội dung ghi chú (bắt buộc, ≤5000 ký tự) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điệc:**
- Có index `{ userId: 1, videoId: 1, createdAt: -1 }`.
- Không sử dụng soft-delete.

#### 4.1.10. **Activity** (`src/app/models/Activity.js`)
Nhật ký hoạt động người dùng (hệ thống tracking).

| Trường | Kiểu | Mô tả |
|---|---|---|
| `userId` | ObjectId → User | Người thực hiện (bắt buộc, có index) |
| `type` | String | Loại hoạt động: `video_started`, `video_completed`, `course_enrolled`, `course_completed`, `certificate_issued`, `review_submitted` |
| `videoId` | ObjectId → Video | Video liên quan (nullable) |
| `courseId` | ObjectId → Course | Khóa học liên quan (nullable) |
| `metadata` | Mixed | Dữ liệu mở rộng (tùy loại) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điệc:**
- Có index `{ userId: 1, createdAt: -1 }` — dùng cho lịch sử xem.
- Không sử dụng soft-delete.

#### 4.1.11. **Session** (`src/app/models/Session.js`)
Phiên đăng nhập (refresh token).

| Trường | Kiểu | Mô tả |
|---|---|---|
| `userId` | ObjectId → User | Người dùng (bắt buộc, có index) |
| `refreshToken` | String | Refresh token ngẫu nhiên (duy nhất, bắt buộc) |
| `expiresAt` | Date | Thời gian hết hạn (bắt buộc) |
| `createdAt`, `updatedAt` | Date | Tự động bởi timestamps |

**Đặc điệc:**
- TTL index `{ expiresAt: 1 }` với `expireAfterSeconds: 0` — MongoDB tự động xóa session hết hạn.
- **Không** sử dụng plugin `mongoose-delete` — session hết hạn phải bị xóa hoàn toàn.

#### 4.1.12. **PlaylistCache** (`src/app/models/PlaylistCache.js`)
Cache danh sách video từ playlist YouTube (tối ưu quota API).

| Trường | Kiểu | Mô tả |
|---|---|---|
| `playlistId` | String | ID playlist (duy nhất, bắt buộc) |
| `videos` | Array | Danh sách video đã fetch |
| `fetchedAt` | Date | Thời gian fetch (mặc định `Date.now`, TTL 300s) |

**Đặc điệc:**
- TTL index qua `expires: 300` — tự động hết hạn sau 5 phút.

### 4.2. Mối Quan Hệ Các Collection

```
User (1) ────< Course (n)              [createdBy]
User (1) ────< Roadmap (n)             [createdBy]
Roadmap (1) ────< Course (n)            [roadmapId]
Course (1) ────< Module (n)            [courseId]
Module (1) ────< Video (n)             [moduleId]
User (1) ────< Enrollment >─── Course (1)  [userId, courseId]
User (1) ────< CourseReview >─── Course (1)  [userId, courseId]
User (1) ────< Certificate >─── Course (1)  [userId, courseId]
User (1) ────< Note >─── Video (1) >─── Course (1)  [userId, videoId, courseId]
User (1) ────< Activity >─── Video/Course (n)  [userId, videoId, courseId]
User (1) ────< Session (n)             [userId]
```

---

## 5. Controllers (Logic Nghiệp Vụ)

Tất cả controller đều được định nghĩa dưới dạng class và export dưới dạng singleton (`module.exports = new ControllerName()`).

### 5.1. **SiteController** (`src/app/controllers/SiteController.js`)
- `index` — Render trang chủ (`GET /`), hiển thị danh sách khóa học.
- `search` — Render trang tìm kiếm (`GET /search`).

### 5.2. **AuthController** (`src/app/controllers/AuthController.js`)
- `showRegister` — Form đăng ký (`GET /auth/register`).
- `register` — Xử lý đăng ký, tự động đăng nhập (`POST /auth/register`).
- `showLogin` — Form đăng nhập (`GET /auth/login`).
- `login` — Xác thực, tạo session + cookie (`POST /auth/login`).
- `logout` — Xóa session trong DB + xóa cookie (`POST /auth/logout`).
- `refreshAccessToken` — Làm mới access token từ refresh token (`POST /auth/refresh`).

### 5.3. **CourseController** (`src/app/controllers/CourseController.js`)
- `show` — Xem chi tiết khóa học theo slug (`GET /courses/:slug`). Tải cây Module → Video, kiểm tra enroll, tiến độ, ghi chú, đánh giá.
- `create` — Form tạo khóa học (`GET /courses/create`).
- `store` — Lưu khóa học mới (`POST /courses/store`). Tự động sinh image từ YouTube, gán `createdBy` từ token.
- `edit` — Form sửa khóa học (`GET /courses/:id/edit`).
- `manage` — Trang quản lý cấu trúc Module/Video (Tree Builder) (`GET /courses/:id/manage`).
- `update` — Cập nhật khóa học (`PUT /courses/:id`).
- `destroy` — Xóa mềm khóa học (`DELETE /courses/:id`).
- `restore` — Khôi phục khóa học đã xóa (`PATCH /courses/:id/restore`).
- `forceDestroy` — Xóa cứng khóa học + cascade xóa Module + Video (`DELETE /courses/:id/force`).
- `fetchPlaylist` — Lấy danh sách video từ playlist YouTube qua Data API v3 (`POST /courses/playlist/items`). Có cache.
- `storePlaylist` — Lưu nhiều video từ playlist (`POST /courses/playlist/store`). Batch insert với retry.

### 5.4. **ModuleController** (`src/app/controllers/ModuleController.js`)
- `store` — Tạo module mới trong Course (`POST /courses/:courseId/modules`).
- `update` — Cập nhật tên module (`PUT /modules/:id`).
- `destroy` — Xóa module + cascade xóa video (`DELETE /modules/:id`).
- `reorderBulk` — Sắp xếp lại thứ tự module qua kéo-thả (`PUT /courses/:courseId/modules/reorder`).

### 5.5. **VideoController** (`src/app/controllers/VideoController.js`)
- `store` — Tạo video mới trong Module (`POST /modules/:moduleId/videos`).
- `update` — Cập nhật thông tin video (`PUT /videos/:id`).
- `destroy` — Xóa video (`DELETE /videos/:id`).
- `reorderBulk` — Sắp xếp lại thứ tự video trong module (`PUT /modules/:moduleId/videos/reorder`).

### 5.6. **EnrollmentController** (`src/app/controllers/EnrollmentController.js`)
- `enroll` — Đăng ký khóa học (upsert, idempotent) (`POST /api/courses/:courseId/enroll`). Kiểm tra quyền theo `isPublic` + `visibility` roadmap.
- `recordWatch` — Ghi nhận video bắt đầu xem (`POST /api/videos/:videoId/watch`). Ghi activity `video_started`.
- `watchHistory` — Trang lịch sử xem, group theo ngày (`GET /me/watch-history`).

### 5.7. **ProgressController** (`src/app/controllers/ProgressController.js`)
- `completeVideo` — Đánh dấu hoàn thành video (atomic `$addToSet`, idempotent) (`POST /api/videos/:videoId/complete`). Tự động phát chứng chỉ nếu hoàn thành 100% và khóa học bật `certificate`.
- `uncompleteVideo` — Bỏ đánh dấu hoàn thành (`$pull`, revert status) (`DELETE /api/videos/:videoId/complete`).
- `getProgress` — Lấy tiến độ chi tiết user trong khóa học (`GET /api/courses/:courseId/progress`).

### 5.8. **NoteController** (`src/app/controllers/NoteController.js`)
- `store` — Tạo ghi chú cho video (`POST /api/videos/:videoId/notes`). Có giới hạn 20 ghi chú cho gói free.
- `index` — Danh sách ghi chú của user theo video (`GET /api/videos/:videoId/notes`).
- `update` — Sửa ghi chú (filter `_id + userId` chống IDOR) (`PUT /api/notes/:id`).
- `destroy` — Xóa ghi chú (filter `_id + userId` chống IDOR) (`DELETE /api/notes/:id`).

### 5.9. **ReviewController** (`src/app/controllers/ReviewController.js`)
- `store` — Tạo/cập nhật đánh giá (upsert, chỉ user đã enroll) (`POST /api/courses/:courseId/reviews`).
- `index` — Danh sách review (public) (`GET /api/courses/:courseId/reviews`).
- `getRating` — Rating trung bình + số lượt (public) (`GET /api/courses/:courseId/rating`).

### 5.10. **RoadmapController** (`src/app/controllers/RoadmapController.js`)
- `index` — Danh sách lộ trình (public + cá nhân) (`GET /roadmaps`).
- `create` — Form tạo lộ trình (`GET /roadmaps/create`).
- `show` — Xem chi tiết lộ trình theo slug (`GET /roadmaps/:slug`).
- `edit` — Form sửa lộ trình + danh sách khóa học cá nhân (`GET /roadmaps/:id/edit`).
- `store` — Tạo lộ trình mới (`POST /roadmaps`).
- `update` — Cập nhật lộ trình (`PUT /roadmaps/:id`).
- `destroy` — Xóa lộ trình (soft-delete) (`DELETE /roadmaps/:id`).
- `assignCourses` — Gán/bỏ gán khóa học vào lộ trình (`PUT /roadmaps/:id/courses`).

### 5.11. **MeController** (`src/app/controllers/MeController.js`)
- `myCourses` — Danh sách khóa học của user (`GET /me/courses`).
- `storedCourses` — Danh sách toàn bộ khóa học (admin) (`GET /me/courses/stored`).
- `trashCourses` — Danh sách khóa học đã xóa (admin) (`GET /me/courses/trash`).
- `myRoadmaps` — Danh sách lộ trình của user (`GET /me/roadmaps`).

### 5.12. **CertificateController** (`src/app/controllers/CertificateController.js`)
- `show` — Trang chứng chỉ (public, in ấn) (`GET /certificates/:certificateId`). Kiểm tra `isPublic` — nếu private chỉ owner xem.

### 5.13. **NewsController** (`src/app/controllers/NewsController.js`)
- `index` — Trang tin tức (`GET /news`).
- `show` — Chi tiết tin tức (`GET /news/:slug`).

---

## 6. Routes (Định Tuyến)

### 6.1. Cấu trúc route

Tất cả route được đăng ký trong `src/routes/index.js` và gắn vào app thông qua hàm `route(app)`.

| Route file | Tiền tố URL | Mô tả |
|---|---|---|
| `site.js` | `/` | Trang chủ, tìm kiếm |
| `news.js` | `/news` | Tin tức |
| `courses.js` | `/courses` | Quản lý khóa học, module, video |
| `modules.js` | `/modules` | Quản lý module, video |
| `videos.js` | `/videos` | Quản lý video |
| `roadmaps.js` | `/roadmaps` | Quản lý lộ trình |
| `me.js` | `/me` | Khu vực cá nhân |
| `auth.js` | `/auth` | Xác thực |
| `api.js` | `/api` | API JSON (enroll, progress, notes, reviews) |
| `certificates.js` | `/certificates` | Chứng chỉ |
| `dev.js` | `/dev` | Dev-only (lấy CSRF token) |

### 6.2. Middleware bảo mật & phân quyền

#### 6.2.1. **auth.js** (`src/app/middlewares/auth.js`)
- `attachUser` — Chạy toàn cục. Đọc `accessToken` từ cookie, giải mã JWT, gán `req.user`. Tự động refresh token nếu hết hạn. Gán `res.locals.user` cho view.
- `requireAuth` — Chặn nếu chưa đăng nhập. Request HTML → redirect `/auth/login`; request API → 401 JSON.
- `requireRole(role)` — Chặn nếu role không khớp. Request HTML → render 403; request API → 403 JSON.

#### 6.2.2. **checkOwnership.js** (`src/app/middlewares/checkOwnership.js`)
- `checkOwnership(Model)` — Factory middleware. Tìm tài nguyên theo `req.params.id`, kiểm tra `createdBy` khớp `req.user.id` (hoặc admin). Gắn document vào `req.resource`.

#### 6.2.3. **checkCourseOwnership.js** (`src/app/middlewares/checkCourseOwnership.js`)
- `checkCourseOwnership({ resourceModel, resolveCourseId })` — Factory middleware. Dùng cho Module/Video (không có `createdBy` riêng). Truy ngược lên Course cha để kiểm tra quyền sở hữu. Gắn resource vào `req.resource`.

#### 6.2.4. **csrf.js** (`src/app/middlewares/csrf.js`)
- `csrfToken` — Gắn CSRF token vào `res.locals.csrfToken` cho mọi request.
- `csrfProtection` — Chặn request POST/PUT/PATCH/DELETE thiếu token. Token được đọc từ body `_csrf` hoặc header `x-csrf-token`.

#### 6.2.5. **cors.js** (`src/app/middlewares/cors.js`)
- CORS whitelist từ biến môi trường `CORS_ORIGINS`. Same-origin luôn được phép. Origin không hợp lệ → 403.

#### 6.2.6. **rateLimit.js** (`src/app/middlewares/rateLimit.js`)
Các loại rate limit:

| Limiter | Áp dụng | Giới hạn |
|---|---|---|
| `authLimiter` | `/auth/*` | 10 req/15phút/IP |
| `apiLimiter` | `/courses/playlist/*` | 30 req/15phút/IP |
| `watchLimiter` | `/api/videos/:videoId/watch` | 30 req/phút/user |
| `progressLimiter` | `/api/videos/:videoId/complete` | 30 req/phút/user |
| `noteLimiter` | `/api/videos/:videoId/notes` | 10 req/phút/user |
| `reviewLimiter` | `/api/courses/:courseId/reviews` | 10 req/giờ/user |
| `certificateLimiter` | `/certificates/:certificateId` | 60 req/15phút/IP |

---

## 7. Views (Template Handlebars)

### 7.1. Cấu trúc views

```
src/resources/views/
├── layouts/
│   └── main.hbs                    # Layout chính (header + footer + body)
├── partials/
│   ├── header.hbs                  # Header điều hướng (desktop + mobile)
│   ├── footer.hbs                  # Footer
│   └── delete-modal.hbs            # Modal xác nhận xóa + toast
├── home.hbs                        # Trang chủ — danh sách khóa học
├── search.hbs                      # Trang tìm kiếm
├── news.hbs                        # Trang tin tức
├── auth/
│   ├── login.hbs                   # Form đăng nhập
│   └── register.hbs                # Form đăng ký
├── courses/
│   ├── show.hbs                    # Chi tiết khóa học (player, progress, notes, reviews)
│   ├── create.hbs                  # Tạo khóa học (tab: single + playlist import)
│   ├── edit.hbs                    # Sửa khóa học
│   └── manage.hbs                  # Quản lý cấu trúc Module/Video (Tree Builder)
├── roadmaps/
│   ├── index.hbs                   # Danh sách lộ trình
│   ├── create.hbs                  # Tạo lộ trình
│   ├── edit.hbs                    # Sửa lộ trình (roadmap builder)
│   └── show.hbs                    # Chi tiết lộ trình
├── me/
│   ├── my-course.hbs               # Khóa học của tôi (table + grid view)
│   ├── my-roadmap.hbs              # Lộ trình của tôi
│   ├── stored-course.hbs           # Tất cả khóa học (admin)
│   ├── trash-course.hbs            # Thùng rác (admin)
│   └── watch-history.hbs           # Lịch sử xem (group theo ngày)
├── certificates/
│   └── show.hbs                    # Trang chứng chỉ (in ấn)
└── errors/
    ├── 403.hbs                     # Lỗi 403 Forbidden
    ├── 404.hbs                     # Lỗi 404 Not Found
    └── 500.hbs                     # Lỗi 500 Internal Server Error
```

### 7.2. Layout & Partial

- **main.hbs**: Layout chuẩn với header, footer, Bootstrap 5, jQuery. Font Geist.
- **header.hbs**: Navigation 3-section (brand | center links | user actions). Có menu mobile collapse. Hiển thị khác nhau cho user đã login vs chưa login. Admin thấy mục "Quản trị hệ thống".
- **footer.hbs**: Footer với brand, link điều hướng, link hỗ trợ, social icon.
- **delete-modal.hbs**: Modal xác nhận xóa + hidden form + toast container cho flash message.

### 7.3. Trang chính

#### Trang chủ (`home.hbs`)
- Hiển thị lưới thẻ khóa học (3 cột responsive).
- Mỗi thẻ: ảnh thumbnail, tên khóa học (link đến `/courses/:slug`), mô tả, nút "Xem khóa học".

#### Chi tiết khóa học (`courses/show.hbs`)
- YouTube iframe player (embed video đầu tiên).
- Thanh hành động: nút Đăng ký / Đã đăng ký / Quản lý nội dung (owner).
- Thanh tiến độ (progress bar) — chỉ hiển thị khi đã enroll.
- Nút đánh dấu hoàn thành / bỏ hoàn thành video.
- Panel ghi chú (thêm/sửa/xóa ghi chú theo video).
- Phần đánh giá (star rating input, comment, danh sách review).
- Sidebar: cây Module → Video (click để chuyển video), đánh dấu số ghi chú.
- JavaScript: AJAX cho enroll, complete/uncomplete, notes CRUD, review submit.

#### Tạo khóa học (`courses/create.hbs`)
- Hai tab: "Thêm 1 khóa học" (form thủ công) và "Nhập từ Playlist YouTube" (bulk import).
- Form: videoid, name, description, level, checkbox certificate.
- Nút "Tự điền" — gọi YouTube oEmbed để lấy tên + thumbnail.
- Playlist import: nhập link/ID playlist → fetch danh sách video → chọn → submit batch.

#### Quản lý cấu trúc (`courses/manage.hbs`)
- Tree Builder: kéo-thả sắp xếp Module và Video (dùng Sortable.js).
- Thêm/sửa/xóa Module và Video inline.
- Modal xác nhận xóa, toast thông báo.

#### Lộ trình (`roadmaps/`)
- `index.hbs`: Danh sách lộ trình dạng thẻ.
- `create.hbs` / `edit.hbs`: Form tạo/sửa lộ trình với roadmap builder (visibility radio, cover image preview, curriculum builder kéo-thả).
- `show.hbs`: Chi tiết lộ trình với danh sách khóa học.

#### Khu vực cá nhân (`me/`)
- `my-course.hbs`: Bảng/quản lý khóa học của user. Có chuyển đổi table/grid view, sắp xếp, flash message.
- `my-roadmap.hbs`: Bảng lộ trình của user.
- `stored-course.hbs`: Bảng tất cả khóa học (admin only).
- `trash-course.hbs`: Bảng khóa học đã xóa (admin only), có nút khôi phục.
- `watch-history.hbs`: Lịch sử xem video, group theo ngày (Hôm nay / Hôm qua / ngày cụ thể), phân trang.

#### Chứng chỉ (`certificates/show.hbs`)
- Trang in ấn độc lập (không dùng layout).
- Thiết kế trang trí viền vàng, font Playfair Display.
- Hiển thị tên người nhận, tên khóa học, ngày cấp, mã xác thực.

#### Trang lỗi (`errors/`)
- 404, 403, 500 — thiết kế đẹp với icon SVG, nút về trang chủ và quay lại.

### 7.4. Handlebars Helpers

Được đăng ký trong `src/index.js`:

| Helper | Mô tả |
|---|---|
| `sum(a, b)` | Cộng hai số |
| `eq(a, b)` | So sánh bằng |
| `times(n, options)` | Lặp n lần (dùng render sao đánh giá) |
| `formatDate(date)` | Định dạng ngày DD/MM/YYYY |
| `getCurrentYear()` | Năm hiện tại (footer) |

---

## 8. Frontend Assets

### 8.1. CSS
- `src/resources/scss/app.scss` — SCSS nguồn chính, biên dịch thành `src/public/css/app.css`.
- `src/resources/scss/_variables.scss` — Biến SCSS.
- `src/public/css/course-table.css` — CSS bảng quản lý khóa học.
- `src/public/css/roadmap-builder.css` — CSS roadmap builder.
- `src/public/css/app.css` — CSS đã biên dịch (có `.map`).

**Thiết kế:** Theo chuẩn Hallmark — theme "Coral" (warm-grey paper + coral accent), modern-minimal, OKLCH color, 4pt spacing scale, major-third type scale, reduced-motion support.

### 8.2. JavaScript
- `src/public/js/jquery-3.7.1.min.js` — jQuery (dùng cho AJAX, DOM manipulation).
- `src/public/js/escape-html.js` — Hàm escape HTML chung (chống XSS).
- `src/public/js/youtube-autofill.js` — Tự điền tên + thumbnail từ YouTube oEmbed (trang tạo khóa học).
- `src/public/js/playlist-import.js` — Import nhiều video từ playlist YouTube (trang tạo khóa học).

### 8.3. Hình ảnh
- `src/public/img/` — Logo, favicon, v.v.

---

## 9. Utils (Tiện Ích Chung)

### 9.1. **token.js** (`src/utils/token.js`)
Quản lý JWT access token và refresh token.
- `signAccessToken(user)` — Tạo JWT access token (TTL 15 phút).
- `generateRefreshToken()` — Tạo refresh token ngẫu nhiên 64 byte (không phải JWT).
- `createSessionAndSetCookies(res, user)` — Tạo session trong DB + set 2 cookie (accessToken + refreshToken, httpOnly, sameSite lax).
- `refreshAccessTokenFromCookie(req, res)` — Làm mới access token từ refresh token cookie. Trả về `{ user }` hoặc `{ user: null }`.

### 9.2. **certificate.js** (`src/utils/certificate.js`)
- `issueCertificate(userId, courseId)` — Phát chứng chỉ (idempotent, race-safe qua unique index + catch E11000). Ghi activity `certificate_issued`.

### 9.3. **progress.js** (`src/utils/progress.js`)
- `getTotalVideosForCourse(courseId)` — Đếm tổng số video qua aggregate (join Module + Video), lọc soft-delete thủ công.

### 9.4. **youtube.js** (`src/utils/youtube.js`)
- `extractPlaylistId(input)` — Parse playlist ID từ input (ID thuần hoặc link).
- `fetchPlaylistVideos(playlistId, apiKey)` — Gọi YouTube Data API v3, phân trang đầy đủ, lọc video hỏng. Trả về `{ videos: [{ videoid, title, thumbnail, available }] }`.
- Hằng số: `MAX_RESULTS_PER_PAGE = 50`, `MAX_VIDEOS_PER_BATCH = 200`.

### 9.5. **validators.js** (`src/utils/validators.js`)
- `validateRegister(body)` — Validate đăng ký (name, username ≥3, email, password ≥8).
- `validateLogin(body)` — Validate đăng nhập (identifier, password).
- `validateCourse(body, isUpdate)` — Validate khóa học (name, videoid 11 ký tự).
- `validatePlaylistFetch(body)` — Validate input playlist.
- Hằng số: `EMAIL_REGEX`, `YOUTUBE_ID_REGEX`.

### 9.6. **slugify.js** (`src/utils/slugify.js`)
- `slugify(str)` — Chuyển chuỗi thành slug (normalize, lowercase, thay đ, xóa ký tự đặc biệt).
- `generateUniqueSlug(Model, name, excludeId)` — Sinh slug duy nhất, kiểm tra trùng qua raw collection (bỏ qua soft-delete).

### 9.7. **mongoose.js** (`src/utils/mongoose.js`)
- `mongooseToObject(mongoose)` — Chuyển Mongoose document thành plain object.
- `multipleMongooseToObject(mongooses)` — Chuyển mảng Mongoose documents thành plain objects.

---

## 10. Luồng Xác Thực & Phân Quyền

### 10.1. Xác thực (Authentication)
1. Người dùng đăng ký/đăng nhập → `AuthController` xác thực.
2. Tạo JWT access token (15 phút) + refresh token (14 ngày, lưu trong DB).
3. Set 2 cookie httpOnly: `accessToken` + `refreshToken`.
4. Middleware `attachUser` chạy toàn cục: đọc `accessToken` từ cookie, giải mã JWT → gán `req.user`. Nếu hết hạn → tự động refresh qua `refreshToken`.
5. Đăng xuất: xóa session trong DB + xóa 2 cookie.

### 10.2. Phân quyền (Authorization)
- **Guest** (chưa đăng nhập): chỉ xem nội dung công khai (trang chủ, khóa học, lộ trình, tin tức).
- **User** (đã đăng nhập): xem công khai + tạo/quản lý tài nguyên **của chính mình**.
- **Admin**: toàn quyền (sửa/xóa tài nguyên bất kỳ, khôi phục, xóa vĩnh viễn, quản lý toàn hệ thống).

**Cơ chế kiểm tra quyền:**
- `requireAuth` — bắt buộc đăng nhập.
- `requireRole('admin')` — bắt buộc role admin.
- `checkOwnership(Model)` — kiểm tra `createdBy` khớp user (dùng cho Course, Roadmap).
- `checkCourseOwnership(...)` — truy ngược lên Course cha (dùng cho Module, Video).

### 10.3. CSRF Protection
- Double-submit cookie pattern (`csrf-csrf`).
- Cookie `_csrf` (httpOnly) lưu secret.
- Token gửi qua body `_csrf` hoặc header `x-csrf-token`.
- Bỏ qua GET/HEAD/OPTIONS.
- Route `/dev/csrf-token` (dev-only) trả token JSON để test Postman.

---

## 11. Các Tính Năng Chính

### 11.1. Quản lý Khóa Học
- Tạo khóa học thủ công (nhập YouTube video ID) hoặc bulk import từ playlist.
- Tự động lấy thumbnail từ YouTube (`https://img.youtube.com/vi/{videoid}/sddefault.jpg`).
- Tự động sinh slug duy nhất.
- Soft-delete + khôi phục (admin) + xóa cứng (admin, cascade xóa Module + Video).
- Quyền sở hữu: chủ khóa học + admin mới được sửa/xóa.

### 11.2. Cây Module → Video (Tree Builder)
- Mỗi khóa học có nhiều Module, mỗi Module có nhiều Video.
- Kéo-thả sắp xếp thứ tự (Sortable.js) — lưu qua API reorder.
- Thêm/sửa/xóa Module và Video inline.
- Cascade xóa: xóa Module → xóa hết Video trong đó.

### 11.3. Đăng Ký & Tiến Độ Học
- Enroll khóa học (upsert, idempotent). Course private chỉ owner/enrolled mới enroll được.
- Đánh dấu hoàn thành video (atomic `$addToSet`, idempotent).
- Tính tiến độ % (có guard chia 0).
- Hoàn thành 100% → tự động set status `completed` + ghi activity.
- Nếu khóa học bật `certificate` → tự động phát chứng chỉ.

### 11.4. Ghi Chú (Notes)
- Tạo ghi chú theo video (giới hạn 20 ghi chú cho gói free).
- Chỉ user đã enroll (hoặc owner) mới tạo được ghi chú trên course private.
- Sửa/xóa chỉ với chính mình (filter `_id + userId` chống IDOR).
- Hiển thị số ghi chú trên mỗi video trong sidebar.

### 11.5. Đánh Giá & Rating
- Đánh giá 1–5 sao + bình luận (upsert, chỉ user đã enroll).
- Rating trung bình + số lượt (aggregate).
- Public — mọi người đều xem được.

### 11.6. Chứng Chỉ
- Tự động phát khi hoàn thành 100% + khóa học bật `certificate: true`.
- Mã chứng chỉ ngẫu nhiên 128-bit (khó đoán, chống quét).
- Trang chứng chỉ public (có thể chia sẻ, in ấn).
- `isPublic: false` → chỉ owner xem.

### 11.7. Lộ Trình (Roadmap)
- Tạo lộ trình với visibility: public/private/draft.
- Gán/bỏ gán khóa học vào lộ trình (chỉ khóa học của chính user).
- Kéo-thả sắp xếp khóa học trong lộ trình.
- Xem chi tiết lộ trình (liệt kê khóa học).

### 11.8. Lịch Sử Xem
- Ghi nhận `video_started` khi user bắt đầu xem.
- Trang lịch sử xem (group theo ngày: Hôm nay / Hôm qua / ngày cụ thể), phân trang.

### 11.9. Quản Trị (Admin)
- Xem toàn bộ khóa học hệ thống.
- Xem thùng rác, khôi phục, xóa vĩnh viễn.
- Tạo tài khoản admin đầu tiên qua script.

---

## 12. Biến Môi Trường (.env)

| Biến | Mô tả | Bắt buộc |
|---|---|---|
| `PORT` | Cổng chạy server (mặc định 3000) | Không |
| `MONGODB_URI` | Connection string MongoDB | Có |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key | Không (dùng oEmbed nếu trống) |
| `JWT_SECRET` | Secret ký JWT access token | Có |
| `CSRF_SECRET` | Secret ký CSRF token | Có |
| `CORS_ORIGINS` | Danh sách origin được phép (phân cách dấu phẩy) | Không (dev) / Có (prod) |
| `NODE_ENV` | Môi trường (production/dev) | Không |
| `ADMIN_NAME` | Tên admin khi tạo | Không |
| `ADMIN_USERNAME` | Username admin | Không |
| `ADMIN_EMAIL` | Email admin | Không |
| `ADMIN_PASSWORD` | Password admin | Không |

---

## 13. Scripts & Testing

### 13.1. Scripts
- `scripts/create-admin.js` — Tạo tài khoản admin đầu tiên.
- `scripts/create-sample-course.js` — Tạo khóa học mẫu.
- `scripts/migrate-roadmap-v2.js` — Migration dữ liệu roadmap v2.
- `scripts/migrate-course-to-module-video.js` — Migration Course → Module/Video.
- `scripts/e2e-test.js` — Test end-to-end.
- `scripts/test-reorder.js` — Test tính năng reorder.

### 13.2. Testing
- `test/course-crud.test.js` — Test CRUD khóa học.
- Sử dụng axios + axios-cookiejar-support + tough-cookie để test với cookie.

---

## 14. Luồng Request Điển Hình

### 14.1. Xem khóa học (guest/user)
1. `GET /courses/:slug` → `CourseController.show`
2. Tải Course theo slug → tải cây Module → Video.
3. Nếu user đã login: kiểm tra enroll, tính tiến độ, đếm ghi chú, lấy review cá nhân.
4. Tính rating trung bình + số lượt.
5. Render `courses/show.hbs` với đầy đủ dữ liệu.

### 14.2. Tạo khóa học (user đã login)
1. `GET /courses/create` → render form.
2. `POST /courses/store` → validate → tạo Course với `createdBy` từ token.
3. Redirect về `/me/courses?created=1`.

### 14.3. Quản lý cấu trúc (owner/admin)
1. `GET /courses/:id/manage` → `checkOwnership(Course)` → render Tree Builder.
2. AJAX: tạo/sửa/xóa Module (`POST/PUT/DELETE /modules/:id`).
3. AJAX: tạo/sửa/xóa Video (`POST/PUT/DELETE /videos/:id`).
4. AJAX: reorder Module/Video (kéo-thả).

### 14.4. Học & tiến độ (user đã enroll)
1. Click video trong sidebar → `playVideo()` → cập nhật iframe + gọi `POST /api/videos/:videoId/watch` (ghi activity).
2. Click "hoàn thành" → `POST /api/videos/:videoId/complete` → atomic `$addToSet` → tính progress → nếu 100% → phát certificate (nếu bật).
3. Ghi chú: `POST /api/videos/:videoId/notes` → `GET /api/videos/:videoId/notes` → `PUT/DELETE /api/notes/:id`.

### 14.5. Đánh giá (user đã enroll)
1. Chọn sao + nhập comment → `POST /api/courses/:courseId/reviews` (upsert).
2. Reload trang để hiển thị review mới + rating cập nhật.

---

## 15. Kiến Trúc Bảo Mật

| Lớp bảo mật | Cơ chế |
|---|---|
| **Xác thực** | JWT access token (15 phút) + refresh token (14 ngày, lưu DB) + cookie httpOnly |
| **CSRF** | Double-submit cookie (`csrf-csrf`), token trong body/header |
| **CORS** | Whitelist origin từ env, same-origin luôn cho phép |
| **Headers** | Helmet + CSP (cho phép YouTube embed, img.youtube.com) |
| **Rate limit** | express-rate-limit (theo IP hoặc userId) |
| **Mật khẩu** | bcrypt hash (salt 12 vòng), `select: false` |
| **IDOR** | Filter `{ _id, userId }` trong cùng 1 query (Note update/delete) |
| **Ownership** | `checkOwnership` / `checkCourseOwnership` middleware |
| **Soft-delete** | `mongoose-delete` (Course, Roadmap, User) — giữ `deletedAt` |
| **Hard-delete** | Module, Video, Note, Activity, Certificate — xóa cứng |
| **XSS** | Handlebars tự escape + `escapeHtml()` cho AJAX chèn nội dung |
| **Fail-fast** | Khởi động server nếu thiếu `JWT_SECRET`, `CSRF_SECRET`, `MONGODB_URI` |

---

## 16. Quy Trình Phát Triển

1. **Cài đặt:** `npm install`
2. **Cấu hình môi trường:** Copy `.env.example` → `.env`, điền `JWT_SECRET`, `CSRF_SECRET`, `MONGODB_URI`, `CORS_ORIGINS`.
3. **Chạy dev server:** `npm start` (nodemon tự động restart).
4. **Biên dịch SCSS:** `npm run watch` (chạy paralell với server).
5. **Tạo admin đầu tiên:** `npm run create-admin` (sau khi có `.env`).
6. **Chạy test:** `npm test` (hiện chưa cấu hình, dùng `node scripts/e2e-test.js`).

---

## 17. Tổng Kết Kiến Trúc

```
                    ┌─────────────────────────────────────┐
                    │           Client (Browser)          │
                    │  HTML + Handlebars + jQuery + SCSS  │
                    └──────────────┬──────────────────────┘
                                   │ HTTP (cookie, CSRF)
                    ┌──────────────▼──────────────────────┐
                    │         Express.js Server           │
                    │  (src/index.js)                     │
                    │  ┌──────────┬──────────┬─────────┐ │
                    │  │ Middleware│  Routes  │ Views   │ │
                    │  │ (auth,   │ (10 file)│ (.hbs)  │ │
                    │  │  csrf,   │          │         │ │
                    │  │  cors,   │          │         │ │
                    │  │  rate)   │          │         │ │
                    │  └──────────┴──────────┴─────────┘ │
                    │  ┌───────────────────────────────┐ │
                    │  │       Controllers (13)        │ │
                    │  └──────────────┬────────────────┘ │
                    └────────────────┼────────────────────┘
                                     │ Mongoose
                    ┌────────────────▼────────────────────┐
                    │         MongoDB Database            │
                    │  12 Collection (Model)              │
                    │  User, Course, Module, Video,      │
                    │  Enrollment, CourseReview,         │
                    │  Certificate, Roadmap, Note,       │
                    │  Activity, Session, PlaylistCache   │
                    └─────────────────────────────────────┘
```

**Vòng lặp MVC:**
- **Route** → nhận request, gọi middleware (auth/csrf/ownership) → gọi **Controller**.
- **Controller** → gọi **Model** (Mongoose) thao tác DB → trả dữ liệu cho **View** (Handlebars render HTML) hoặc trả JSON (API).
- **Utils** → hỗ trợ chung (token, certificate, progress, youtube, validators, slugify).
