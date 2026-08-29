# Bảng Phân Quyền Hệ Thống V-Connect

> Tài liệu mô tả chi tiết quyền truy cập của từng role đối với tất cả các trang/route trong hệ thống.

---

## 1. Tổng quan hệ thống role

| Role | Mô tả |
|---|---|
| **Khách** | Chưa đăng nhập — chỉ xem được nội dung công khai |
| **User** | Đã đăng nhập — xem nội dung công khai + tạo/quản lý tài nguyên **của chính mình** |
| **Admin** | Đã đăng nhập với role `admin` — **toàn quyền** trên mọi tài nguyên |

### Cơ chế phân quyền trong code

| Middleware | Ý nghĩa |
|---|---|
| `requireAuth` | Chặn nếu chưa đăng nhập → redirect `/auth/login` (hoặc 401 JSON cho API) |
| `requireRole('admin')` | Chỉ cho phép role `admin` → 403 nếu không đủ quyền |
| `checkOwnership(Model)` | User chỉ được phép nếu là **người tạo** (`createdBy` khớp `req.user.id`); Admin luôn được phép |
| `checkCourseOwnership(...)` | Module/Video truy ngược lên **Course cha** để kiểm tra quyền sở hữu; Admin luôn được phép |

---

## 2. Bảng phân quyền chi tiết

### 2.1. Trang chủ & Tìm kiếm

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /` | Trang chủ | ✅ | ✅ | ✅ |
| `GET /search` | Tìm kiếm | ✅ | ✅ | ✅ |

### 2.2. Tin tức

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /news` | Danh sách tin tức | ✅ | ✅ | ✅ |
| `GET /news/:slug` | Chi tiết tin tức | ✅ | ✅ | ✅ |

### 2.3. Xác thực (Auth)

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /auth/register` | Form đăng ký | ✅ | ✅ | ✅ |
| `POST /auth/register` | Xử lý đăng ký | ✅ | ✅ | ✅ |
| `GET /auth/login` | Form đăng nhập | ✅ | ✅ | ✅ |
| `POST /auth/login` | Xử lý đăng nhập | ✅ | ✅ | ✅ |
| `POST /auth/logout` | Đăng xuất | ❌ | ✅ | ✅ |
| `POST /auth/refresh` | Refresh access token | ✅ | ✅ | ✅ |

> **Ghi chú:** User/Admin đã đăng nhập vẫn có thể truy cập form login/register (không bị chặn), nhưng thông thường UI sẽ không hiển thị link này.

### 2.4. Khóa học (Courses)

#### Xem khóa học — Công khai

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /courses/:slug` | Xem chi tiết khóa học | ✅ | ✅ | ✅ |

#### Tạo khóa học — Cần đăng nhập (UGC)

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /courses/create` | Form tạo khóa học | ❌ | ✅ | ✅ |
| `POST /courses/store` | Lưu khóa học mới | ❌ | ✅ | ✅ |

#### Sửa / Xóa khóa học — Chủ sở hữu hoặc Admin

| Route | Mô tả | Khách | User (chủ sở hữu) | User (không sở hữu) | Admin |
|---|---|---|---|---|---|
| `GET /courses/:id/edit` | Form sửa khóa học | ❌ | ✅ | ❌ | ✅ |
| `GET /courses/:id/manage` | Quản lý cấu trúc Module/Video (Tree Builder) | ❌ | ✅ | ❌ | ✅ |
| `PUT /courses/:id` | Cập nhật khóa học | ❌ | ✅ | ❌ | ✅ |
| `DELETE /courses/:id` | Xóa mềm khóa học | ❌ | ✅ | ❌ | ✅ |

#### Quản trị khóa học — Chỉ Admin

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `PATCH /courses/:id/restore` | Khôi phục khóa học đã xóa | ❌ | ❌ | ✅ |
| `DELETE /courses/:id/force` | Xóa vĩnh viễn khóa học | ❌ | ❌ | ✅ |

#### Playlist — Cần đăng nhập

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `POST /courses/playlist/items` | Lấy danh sách video từ playlist | ❌ | ✅ | ✅ |
| `POST /courses/playlist/store` | Lưu playlist | ❌ | ✅ | ✅ |

### 2.5. Module & Video — Chủ sở hữu Course hoặc Admin

> **Cơ chế:** Module/Video **không có** `createdBy` riêng. Quyền được kiểm tra bằng cách truy ngược lên **Course cha**:
> - Module → `Module.courseId` → `Course.createdBy`
> - Video → `Video.moduleId` → `Module.courseId` → `Course.createdBy`

| Route | Mô tả | Khách | User (chủ sở hữu Course) | User (không sở hữu) | Admin |
|---|---|---|---|---|---|
| `POST /courses/:courseId/modules` | Tạo module mới trong Course | ❌ | ✅ | ❌ | ✅ |
| `PUT /courses/:courseId/modules/reorder` | Sắp xếp lại thứ tự Module | ❌ | ✅ | ❌ | ✅ |
| `POST /modules/:moduleId/videos` | Tạo video mới trong Module | ❌ | ✅ | ❌ | ✅ |
| `PUT /modules/:id` | Cập nhật Module | ❌ | ✅ | ❌ | ✅ |
| `DELETE /modules/:id` | Xóa Module | ❌ | ✅ | ❌ | ✅ |
| `PUT /modules/:moduleId/videos/reorder` | Sắp xếp lại thứ tự Video | ❌ | ✅ | ❌ | ✅ |
| `PUT /videos/:id` | Cập nhật Video | ❌ | ✅ | ❌ | ✅ |
| `DELETE /videos/:id` | Xóa Video | ❌ | ✅ | ❌ | ✅ |

### 2.6. Lộ trình (Roadmaps)

#### Xem lộ trình — Công khai

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /roadmaps` | Danh sách lộ trình | ✅ | ✅ | ✅ |
| `GET /roadmaps/:slug` | Chi tiết lộ trình | ✅ | ✅ | ✅ |

#### Tạo lộ trình — Cần đăng nhập

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /roadmaps/create` | Form tạo lộ trình | ❌ | ✅ | ✅ |
| `POST /roadmaps` | Lưu lộ trình mới | ❌ | ✅ | ✅ |

#### Sửa / Xóa lộ trình — Chủ sở hữu hoặc Admin

| Route | Mô tả | Khách | User (chủ sở hữu) | User (không sở hữu) | Admin |
|---|---|---|---|---|---|
| `GET /roadmaps/:id/edit` | Form sửa lộ trình | ❌ | ✅ | ❌ | ✅ |
| `PUT /roadmaps/:id/courses` | Gán khóa học vào lộ trình | ❌ | ✅ | ❌ | ✅ |
| `PUT /roadmaps/:id` | Cập nhật lộ trình | ❌ | ✅ | ❌ | ✅ |
| `DELETE /roadmaps/:id` | Xóa lộ trình | ❌ | ✅ | ❌ | ✅ |

### 2.7. Khu vực cá nhân (Me)

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /me/roadmaps` | Danh sách lộ trình của tôi | ❌ | ✅ | ✅ |
| `GET /me/courses` | Danh sách khóa học của tôi | ❌ | ✅ | ✅ |

### 2.8. Quản trị (Admin only)

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /me/courses/stored` | Danh sách khóa học đã lưu (toàn hệ thống) | ❌ | ❌ | ✅ |
| `GET /me/courses/trash` | Danh sách khóa học đã xóa (thùng rác) | ❌ | ❌ | ✅ |

### 2.9. Dev / Testing

| Route | Mô tả | Khách | User | Admin |
|---|---|---|---|---|
| `GET /dev/csrf-token` | Lấy CSRF token (chỉ khi `NODE_ENV !== 'production'`) | ✅* | ✅* | ✅* |

> **\*** Route này chỉ tồn tại khi `NODE_ENV !== 'production'`. Trong môi trường production, route trả về **404** cho tất cả mọi người.

---

## 3. Tóm tắt nhanh

| Nhóm chức năng | Khách | User | Admin |
|---|---|---|---|
| Xem trang chủ, tin tức, khóa học, lộ trình | ✅ | ✅ | ✅ |
| Đăng ký / Đăng nhập | ✅ | ✅ | ✅ |
| Đăng xuất | ❌ | ✅ | ✅ |
| Tạo khóa học / lộ trình | ❌ | ✅ | ✅ |
| Sửa / xóa tài nguyên của mình | ❌ | ✅ | ✅ |
| Sửa / xóa tài nguyên của người khác | ❌ | ❌ | ✅ |
| Quản lý Module/Video (chủ sở hữu Course) | ❌ | ✅ | ✅ |
| Khôi phục / xóa vĩnh viễn | ❌ | ❌ | ✅ |
| Khu vực cá nhân (`/me/*`) | ❌ | ✅ | ✅ |
| Quản trị (`/me/courses/stored`, `/me/courses/trash`) | ❌ | ❌ | ✅ |

---

## 4. Quy tắc phân quyền chung

1. **Nội dung công khai** (trang chủ, tin tức, chi tiết khóa học, danh sách/chi tiết lộ trình) — mọi người đều xem được, **không cần đăng nhập**.
2. **Thao tác ghi** (tạo, sửa, xóa) — **bắt buộc đăng nhập** (`requireAuth`).
3. **Quyền sở hữu** — User chỉ được sửa/xóa tài nguyên do **chính mình tạo** (`createdBy`). Admin luôn được phép.
4. **Quyền Admin** — Các thao tác đặc biệt (khôi phục, xóa vĩnh viễn, xem toàn bộ khóa học hệ thống) chỉ dành cho `admin`.
5. **Module/Video** — Không có `createdBy` riêng, phân quyền **truy ngược lên Course cha**.
6. **Khi không đủ quyền**:
   - Request HTML → redirect `/auth/login` (nếu chưa đăng nhập) hoặc render trang **403** (nếu đã đăng nhập nhưng thiếu quyền).
   - Request API (JSON) → trả về **401** (chưa đăng nhập) hoặc **403** (thiếu quyền).