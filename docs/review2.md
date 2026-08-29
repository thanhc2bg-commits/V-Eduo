# Báo Cáo Review — Lỗi "Failed to fetch" khi Thêm Nhiều Video từ Playlist YouTube

> Điều tra và vá lỗi hàng loạt khi thêm video từ playlist YouTube tại `/courses/create`.
> Thời gian: 20/08/2026

---

## 1. Triệu chứng

Khi chọn nhiều video (59 video) từ playlist rồi bấm **"Thêm video đã chọn"**, hệ thống báo:

```
Thành công: 0
Bỏ qua (trùng): 0
Lỗi: 59
Chi tiết lỗi: tất cả đều ghi "Failed to fetch"
```

---

## 2. Điều tra code thực tế

### 2.1 Frontend — `src/public/js/playlist-import.js`

- Nút "Thêm video đã chọn" gọi `fetch('/courses/playlist/store', { method: 'POST', ... })`.
- **Trước khi sửa**: chia danh sách video thành các chunk nhỏ (5 video/lần, `CONCURRENCY = 5`) và gửi **nhiều request tuần tự** qua vòng lặp `for`.
- Mỗi chunk gọi `await res.json()` để đọc kết quả.

### 2.2 Backend — `src/app/controllers/CourseController.js` (`storePlaylist`)

- Nhận `req.body.items`, validate, tạo **1 Course mới + 1 Module + N Video**.
- **Trước khi sửa**: kết thúc bằng `res.redirect('/courses/:id/manage')` — trả **302 + HTML**, KHÔNG phải JSON.

### 2.3 Middleware liên quan

- `src/routes/courses.js`: route `/playlist/store` có `apiLimiter` (max **30 request / 15 phút**).
- `src/app/middlewares/csrf.js`: chấp nhận header `x-csrf-token` — **đúng**, không phải nguyên nhân.
- `src/index.js`: có `express.json()` + error handler trả JSON khi `Accept: application/json`.

---

## 3. Nguyên nhân gốc

### 🔴 Nguyên nhân chính — Backend trả redirect thay vì JSON

`storePlaylist` kết thúc bằng `res.redirect(...)` → trả **302** với body là **HTML** (trang manage).
Frontend gọi `await res.json()` → khi response là redirect/HTML, `res.json()` **throw** `SyntaxError: Unexpected token '<'` (hoặc "Failed to fetch" khi redirect bị chặn bởi trình duyệt).

→ **Mọi chunk đều rơi vào `catch`** → tất cả 59 video đều bị đếm là lỗi "Failed to fetch".

### 🟠 Nguyên nhân phụ — Mỗi chunk tạo 1 Course riêng biệt

Frontend chia 59 video thành ~12 chunk (5 video/lần). Mỗi chunk gọi `/playlist/store` → backend tạo **1 Course mới** cho mỗi request.

→ Nếu không lỗi redirect, hệ thống vẫn tạo **12 khóa học riêng biệt** thay vì 1 khóa học chứa 59 video — sai logic nghiệp vụ.

### 🟡 Nguyên nhân tiềm ẩn — Rate limit

`apiLimiter` giới hạn **30 request / 15 phút**. Với 12 chunk + 1 request lấy playlist = 13 request, chưa vượt ngay, nhưng nếu có retry thủ công sẽ nhanh chóng chạm giới hạn → trả 429 → client thấy lỗi.

---

## 4. Các fix đã áp dụng

### 4.1 Backend — `src/app/controllers/CourseController.js`

**Trước:**
```js
// 5. Redirect đến trang quản lý (đã có sẵn Course + Module + Videos)
res.redirect(`/courses/${course._id}/manage`);
```

**Sau:**
```js
// 5. Trả JSON kết quả — client dùng để hiển thị báo cáo
res.json({
    success: validItems.map((item) => item.youtubeId),
    duplicate: [],
    errors,
    courseId: course._id,
});
```

→ Backend giờ trả **JSON** đúng chuẩn, client parse được, không còn "Failed to fetch".

### 4.2 PlaylistCache — `src/app/models/PlaylistCache.js`

Thêm field `truncated` vào schema để đánh dấu cache bị cắt (khi playlist > 200 video), tránh bị Mongoose strict mode âm thầm loại bỏ:

```js
truncated: { type: Boolean, default: false },
```

### 4.3 Frontend — `src/public/js/playlist-import.js`

1. **Gửi toàn bộ video trong 1 request duy nhất** (thay vì chia chunk):
   - Backend tạo 1 Course + 1 Module + N Video trong 1 lần gọi.
   - Không còn nguy cơ tạo nhiều Course riêng lẻ.
   - Giảm số request → tránh rate limit.

2. **Thêm timeout 120s** (`REQUEST_TIMEOUT`) — đủ cho việc tạo Course + insert nhiều video.

3. **Thêm retry logic** (`MAX_RETRIES = 3`) với backoff (500ms → 1s → 2s):
   - Retry khi lỗi mạng tạm thời, timeout, hoặc lỗi 5xx.
   - Không retry lỗi 4xx (lỗi client, retry vô ích).

4. **Cải thiện thông báo lỗi** — hiển thị HTTP status + message thực tế thay vì "Failed to fetch" chung chung:
   - `'Lỗi không xác định (HTTP ' + result.status + ')'`
   - `'Hết thời gian chờ phản hồi từ máy chủ'` (khi timeout)
   - `'Không thể kết nối tới máy chủ'` (khi network error)

---

## 5. Kết quả kỳ vọng sau khi sửa

| Trước | Sau |
|---|---|
| 59 lỗi "Failed to fetch" | 59 video thành công trong 1 Course |
| 12 Course riêng biệt (nếu không lỗi) | 1 Course duy nhất chứa 59 video |
| Không biết lỗi thật là gì | Hiển thị HTTP status + message cụ thể |
| Dễ chạm rate limit (nhiều request) | Chỉ 1 request → không lo rate limit |

---

## 6. Hướng dẫn kiểm tra lại

1. Khởi động server: `npm start` (hoặc `npm run dev`).
2. Mở `http://localhost:3000/courses/create`, đăng nhập.
3. Tab **"Nhập từ Playlist YouTube"**, dán link playlist, bấm **"Lấy danh sách"**.
4. Chọn nhiều video (ví dụ 59), bấm **"Thêm video đã chọn"**.
5. Kỳ vọng: báo cáo **"Đã thêm thành công 59 video"**.
6. Vào **"Khóa học của tôi"** → chỉ có **1 khóa học mới** chứa đủ 59 video.

---

## 7. Kết luận

Lỗi "Failed to fetch" hàng loạt không phải do mạng hay server crash, mà do **backend trả redirect (302/HTML) trong khi frontend mong đợi JSON**. Đã vá bằng cách:
- Backend trả JSON kết quả thay vì redirect.
- Frontend gửi toàn bộ video trong 1 request, thêm timeout + retry, và hiển thị lỗi chi tiết (HTTP status + message) để dễ chẩn đoán nếu lỗi tái diễn.

---

## 8. Review độc lập (không tin tưởng mù quáng vào fix trước đó)

> Phần này review lại 3 file đã sửa + các model/middleware liên quan, xác minh từng yêu cầu.

### 8.1 Xác minh các bug đã báo cáo

#### ✅ a. Backend `storePlaylist` trả JSON mọi nhánh

Đã xác nhận trong `CourseController.js`:
- Nhánh `items.length === 0` → `res.status(400).json(...)` ✅
- Nhánh `items.length > MAX` → `res.status(400).json(...)` ✅
- Nhánh `validItems.length === 0` → `res.status(400).json(...)` ✅
- Nhánh `itemsToInsert.length === 0` (100% trùng) → `res.status(200).json(...)` ✅
- Nhánh thành công → `res.json({ success, duplicate, errors, courseId })` ✅
- Nhánh lỗi `11000` → `res.status(409).json(...)` ✅
- Nhánh lỗi khác → `next(err)` → error handler `src/index.js` trả JSON khi `Accept: application/json` ✅

→ **Không còn nhánh nào trả redirect.** Đúng yêu cầu.

#### ✅ b. Frontend gửi TOÀN BỘ video trong 1 request

`playlist-import.js` `submitAll()` gửi `body: JSON.stringify({ items: selected })` — toàn bộ danh sách đã chọn trong **1 request duy nhất**. Không còn vòng lặp chunk. ✅

#### ✅ c. Cơ chế "Bỏ qua (trùng)" thật sự

`storePlaylist` có query DB thật:
```js
const existingDocs = await Video.find({
    youtubeId: { $in: validItems.map((v) => v.youtubeId) },
}).select('youtubeId').lean();
const existingIds = new Set(existingDocs.map((d) => d.youtubeId));
```
→ Tách `duplicateIds` và `itemsToInsert` trước khi insert. `duplicate` trong response là **mảng thật**, không phải rỗng giả. ✅

#### ✅ d. Cờ `truncated` xuyên suốt

- `youtube.js` `fetchPlaylistVideos`: `const truncated = Boolean(pageToken)` — đúng logic (nếu còn pageToken sau vòng lặp nghĩa là bị cắt). ✅
- `CourseController.fetchPlaylist`: nhánh cache trả `truncated: Boolean(cached.truncated)`; nhánh API mới trả `truncated` từ `fetchPlaylistVideos`; lưu cache kèm `truncated`. ✅
- `playlist-import.js`: hiển thị cảnh báo khi `data.truncated` true. ✅

→ Cờ `truncated` được truyền đầy đủ từ youtube.js → controller (cả 2 nhánh) → frontend. ✅

### 8.2 Kiểm tra PlaylistCache model

`PlaylistCache.js` đã có:
```js
truncated: { type: Boolean, default: false },
```
→ Mongoose strict mode sẽ **giữ** field này khi lưu. Bug tiềm ẩn đã được sửa. ✅

### 8.3 Data integrity

#### ⚠️ Không có transaction — rủi ro orphan record

`storePlaylist` thực hiện 3 bước tuần tự: `course.save()` → `module.save()` → `Video.insertMany()`. Nếu bước 2 hoặc 3 fail giữa chừng (lỗi DB, validate), sẽ để lại **Course/Module mồ côi** trong DB.

**Đánh giá transaction:**
- `src/config/db/index.js` dùng URI mặc định `mongodb://localhost:27017/V-connect-dev` — **không có `replicaSet`** trong URI.
- MongoDB transaction (session) **chỉ hoạt động với replica set / mongos**, không hoạt động trên standalone.
- → Bọc transaction sẽ **không chạy được** với cấu hình hiện tại, trừ khi đổi sang replica set.

**Đề xuất (không bắt buộc ngay):**
- Nếu muốn an toàn tuyệt đối: nâng cấp MongoDB lên replica set (1 node cũng được) rồi bọc 3 bước trong `session.withTransaction()`.
- Nếu giữ standalone: chấp nhận rủi ro thấp (lỗi DB giữa chừng hiếm), hoặc thêm cleanup thủ công khi catch lỗi (xóa Course/Module vừa tạo nếu insert video fail).

#### ⚠️ Video model KHÔNG có unique index

`Video.js` chỉ có `index: true` trên `moduleId`, **không có unique index** trên `youtubeId` hay tổ hợp `youtubeId + moduleId`.

→ Dedup ở bước 1c chỉ là **ràng buộc cấp ứng dụng**, không có ràng buộc cứng ở DB. Nếu **2 request submit đồng thời** cùng playlist (2 tab, hoặc double-click), cả 2 đều query `Video.find` thấy chưa tồn tại → cả 2 insert → **trùng lặp**.

**Đánh giá rủi ro:** Thấp trong thực tế (người dùng thường thêm 1 lần), nhưng nếu muốn chắc chắn nên thêm unique index:
```js
youtubeId: { type: String, required: true, unique: true }
```
Lưu ý: unique index toàn cục trên `youtubeId` sẽ **chặn cùng 1 video xuất hiện ở 2 khóa học khác nhau** — cần cân nhắc nghiệp vụ. Nếu muốn cho phép video trùng ở khóa khác nhưng không trùng trong cùng khóa, dùng compound unique `{ youtubeId, moduleId }`.

### 8.4 Edge cases

#### ✅ Chọn 0 video
`playlist-import.js` kiểm tra `if (!selected.length)` → hiển thị "Vui lòng chọn ít nhất 1 video." và **không gọi API**. ✅

#### ✅ 100% video trùng
`storePlaylist` có nhánh `itemsToInsert.length === 0` → trả `res.status(200).json({ success: [], duplicate: [...], courseId: null })` — **không tạo Course rỗng**. Frontend hiển thị "Bỏ qua (trùng): N". ✅

#### ⚠️ YouTube API lỗi giữa chừng khi phân trang
`fetchPlaylistVideos` throw ngay khi gặp lỗi ở trang bất kỳ (ví dụ trang 3/5) → **mất toàn bộ dữ liệu đã fetch ở các trang trước** (không cache partial, không trả partial). `fetchPlaylist` catch → trả lỗi rõ ràng (message tiếng Việt + status). 
→ Lỗi được báo rõ ràng, nhưng **không giữ được dữ liệu đã lấy** — người dùng phải thử lại từ đầu. Đây là hành vi chấp nhận được, không phải bug, nhưng có thể cải thiện (cache partial) nếu muốn.

#### ⚠️ Double-click "Thêm video đã chọn"
Trong `playlist-import.js`, nút `$btnAdd` được tạo và gắn listener trong `renderPreview()`. Khi click:
1. Click handler chạy → `submitAll()` → `$btnFetch.prop('disabled', true)` + disable checkbox.
2. Nhưng **nút `$btnAdd` KHÔNG bị disable** — chỉ `$btnFetch` và checkbox bị disable.

→ Nếu user double-click rất nhanh, **2 request có thể được gửi** trước khi request đầu hoàn tất (vì `submitAll` là async, `$btnFetch.prop('disabled', true)` chạy đồng bộ ngay đầu hàm nhưng nút `$btnAdd` vẫn click được).

**Đề xuất fix:** disable nút `$btnAdd` ngay đầu `submitAll`:
```js
$btnAdd.prop('disabled', true);
```
và re-enable ở cuối. (Hiện tại nút `$btnAdd` không có biến tham chiếu ngoài scope — cần lưu lại hoặc dùng selector `$('#btn-add-playlist')`.)

### 8.5 Bảo mật

#### ✅ `req.user.id` từ token, không từ body
`storePlaylist` dùng `createdBy: req.user.id` — `req.user` được gắn bởi `attachUser` từ JWT cookie (`auth.js`), **không đọc từ `req.body`**. ✅

#### ✅ Validate + chuẩn hóa youtubeId
Mọi `youtubeId` từ client đều qua `extractVideoId()` (chuẩn hóa URL/ID thuần, chỉ chấp nhận 11 ký tự hợp lệ). Title được `.trim()`. ✅

#### ✅ Rate limit + auth
Route `/playlist/store` có `apiLimiter` (30 req/15 phút) + `requireAuth`. ✅

---

## 9. Tổng kết review độc lập

### ✅ Đã xác nhận đúng
1. `storePlaylist` trả JSON ở **mọi nhánh** (thành công + lỗi), không còn redirect.
2. Frontend gửi **toàn bộ video trong 1 request**.
3. Cơ chế duplicate **query DB thật** (`Video.find` + `$in`), không phải mảng rỗng giả.
4. Cờ `truncated` truyền **xuyên suốt** youtube.js → controller (cache + API mới) → frontend.
5. `PlaylistCache` đã có field `truncated` — không bị strict mode loại bỏ.
6. Edge case 0 video, 100% trùng xử lý đúng.
7. Bảo mật: `req.user.id` từ token, validate youtubeId, rate limit + auth đầy đủ.

### ⚠️ Còn vấn đề, cần sửa (đề xuất, chưa tự sửa)
1. **Double-click** — nút "Thêm video đã chọn" (`$btnAdd`) không bị disable trong `submitAll`, có thể gửi 2 request trùng. → Fix: disable `$btnAdd` ngay đầu `submitAll`.
2. **Không có transaction** — nếu `Module.save()`/`Video.insertMany()` fail giữa chừng sẽ để orphan Course/Module. MongoDB đang standalone (không replicaSet) nên transaction không khả dụng. → Cân nhắc nâng replica set hoặc cleanup thủ công khi catch.
3. **Video không có unique index** — dedup chỉ ở cấp ứng dụng, race condition nếu 2 request đồng thời. → Cân nhắc thêm unique index (compound `{ youtubeId, moduleId }` nếu muốn cho phép video trùng ở khóa khác).

### ❓ Cần thêm thông tin/file khác
1. **Cấu hình MongoDB thực tế** — cần xác nhận `MONGODB_URI` trong `.env` (không phải `.env.example`) có `replicaSet` hay không, để quyết định có thể dùng transaction được không.
2. **Nghiệp vụ video trùng** — cần xác nhận: 1 video có được phép xuất hiện ở nhiều khóa học khác nhau không? Điều này quyết định loại unique index nên thêm.

---

*Tài liệu kết thúc.*