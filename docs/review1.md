# Báo Cáo Review Toàn Bộ — Tính Năng Học Tập V-Connect (Phase 1 → 5)

> Tài liệu tổng kết toàn bộ quá trình review, vá lỗi, và xác nhận bằng code thật
> cho 5 tính năng học tập được tích hợp vào V-Connect.
> Thời gian: 19-20/08/2026

---

## 1. Phạm vi

| Phase | Tính năng | Trạng thái |
|---|---|---|
| 1 | Enrollment + Watch History | ✅ Hoàn thành |
| 2 | Progress + Notes | ✅ Hoàn thành |
| 3 | Rating/Review | ✅ Hoàn thành |
| 4 | Certificate (opt-in) | ✅ Hoàn thành |
| 5 | Polish + Test thật + Cleanup script | ✅ Hoàn thành |

---

## 2. Các vòng vá lỗi qua các Phase

### Bản kế hoạch 2.0 → code thực tế (9 lỗi đã vá)

| # | Lỗi | Cách vá | Xác nhận |
|---|---|---|---|
| 1 | Race condition `push + save` không atomic | `findOneAndUpdate` + `$addToSet` (atomic + idempotent) | ✅ Test thật CASE 1 |
| 2 | Cast ObjectId thiếu `new` | `new mongoose.Types.ObjectId()` + `isValidObjectId()` | ✅ Code |
| 3 | Rule DELETE `/complete` không rõ | `$pull` + revert `status:'active'` + **giữ chứng chỉ (snapshot)** | ✅ Code |
| 4 | IDOR Note (update/delete) | Filter `{ _id, userId }` trong CÙNG 1 lệnh | ✅ Test thật CASE 2 |
| 5 | Auto-enroll mọi user (lỗ hổng bản 2.0) | Tách 2 nhánh: non-owner chưa enroll → 403; owner → upsert | ✅ Test thật CASE 3 + code |
| 6 | Upsert CourseReview thiếu option | `setDefaultsOnInsert: true` + `context: 'query'` | ✅ Code |
| 7 | Rate limit theo IP sai cho route authed | `userKeyGenerator` theo `userId` | ✅ Code |
| 8 | Enroll race | `findOneAndUpdate` + `upsert` | ✅ Code |
| 9 | `totalVideos` N+1 | 1 aggregate pipeline | ✅ Code |

### Bản 2.1 → bản 2.2 → bản 2.2.1 (vá thêm từng đợt review)

| # | Lỗi | Cách sửa |
|---|---|---|
| 1 | NoteController thiếu check quyền xem course | Thêm `canViewCourse()` trong `store()` |
| 2 | `/complete` thiếu rate limiter | `progressLimiter` (30 req/user/phút) |
| 3 | Activity `video_completed` ghi trùng | `isNewlyCompleted = !!newlyAdded` (filter `$ne`) |
| 4 | `enroll()` thiếu check `course.isPublic` + roadmap | Thêm check — private → owner only |
| 5 | `getTotalVideosForCourse()` thiếu lọc module.deleted | Thêm `'module.deleted': { $ne: true }` |
| 6 | `progressPercent` chia 0 | Guard `total > 0 ? ... : 0` |
| 7 | Race condition `isNewlyCompleted` (bước 2) | Filter `$ne` ngay trong `findOneAndUpdate` — atomic thật sự |

### Cổng `course.certificate` (opt-in, Phase 4)

- Field `certificate: { type: Boolean, default: false }` trong `Course.js`
- Checkbox trong `create.hbs` + `edit.hbs`
- `store()`/`update()` ép `undefined → false`
- `completeVideo()` chỉ gọi `issueCertificate()` khi `course.certificate === true`
- Message "🏆 hoàn thành → nhận chứng chỉ" chỉ hiện khi bật cờ

---

## 3. Test thực tế — `test/learning-features.test.js`

### 3.1 Kết quả chạy thật

```
=== CASE 1: RACE CONDITION — 2 request đồng thời ===
PASS | completedVideoIds.length=1 (kỳ vọng 1), activityCount=1 (kỳ vọng 1), HTTP=[200,200]

CASE 2a PASS | User B sửa note user A: HTTP=404, content DB không đổi
CASE 2b PASS | User B xóa note user A: HTTP=404, note còn tồn tại=true

PASS | CASE 3: complete HTTP=403 (kỳ vọng 403), enroll HTTP=403 (kỳ vọng 403)

KẾT QUẢ: 4 PASS / 0 FAIL
```

### 3.2 An toàn dữ liệu cleanup test

- Script dùng `_id` chính xác từng document tạo ra trong lần chạy: `User.deleteOne({ _id: userAId })`, `Course.deleteOne({ _id: course._id })`,...
- KHÔNG dùng điều kiện lỏng lẻo (xóa theo tên/slug/email trùng một phần).
- Users test có username/email đặc biệt `usera_${ts}`/`userb_${ts}` (timestamp) — không đụng dữ liệu thật.
- `Note/Enrollment/Activity` xóa theo `userId: { $in: [userAId, userBId] }` — chính xác 2 user test.

### 3.3 Race condition — đúng nghĩa "đồng thời"

```js
// Trong main():
const results = await Promise.all([
    api(cookieA, 'POST', `/api/videos/${video._id}/complete`),
    api(cookieA, 'POST', `/api/videos/${video._id}/complete`),
]);
```

Hàm `api()` bắt đầu `fetch()` (không `await` gì trước đó):
```js
async function api(cookie, method, path, body) {
    // ... xây headers
    const res = await fetch(BASE_URL + path, { method, headers });
    return res;
}
```
→ Cả 2 lệnh `api(...)` trong mảng array được **khởi tạo đồng thời** (mỗi lần chạy `fetch` ngay lập tức), rồi `Promise.all` mới thu gom kết quả. KHÔNG phải tuần tự.

---

## 4. Script cleanup activity 90 ngày — `scripts/cleanup-old-activities.js`

- Điều kiện: `{ createdAt: { $lt: cutoffDate } }` — chỉ xóa bản ghi CŨ HƠN cutoff.
- Có comment ⚠️ nhắc KHÔNG đổi dấu / KHÔNG bỏ createdAt.
- Xóa theo batch 5000 — tránh lock.
- Đếm trước (countDocuments) — báo cáo trước khi xóa.
- Cấu hình: `ACTIVITY_RETENTION_DAYS` env (mặc định 90).

---

## 5. Kết luận

Toàn bộ 5 phase đã qua đủ vòng vá và xác minh bằng code thật + test thật (4 PASS / 0 FAIL cho 3 loại lỗi cốt lõi: race, IDOR, authorization). Cổng `course.certificate` opt-in được kiểm chứng. Script cleanup 90 ngày an toàn — không thể xóa nhầm dữ liệu mới do filter `$lt` cẩn thận.

---

*Tài liệu kết thúc.*