const express = require('express');
const router = express.Router();

// Route dev-only: trả CSRF token dạng JSON để test qua Postman.
//
// MỤC ĐÍCH: Chỉ dùng để hỗ trợ development/testing. Khi gọi API qua Postman
// (hoặc client JS), ta cần lấy CSRF token để gửi kèm trong header `x-csrf-token`
// hoặc body `_csrf` cho các request POST/PUT/PATCH/DELETE.
//
// LÝ DO AN TOÀN: Route này lộ CSRF token ra ngoài. Nếu chạy ở production, kẻ
// tấn công có thể lợi dụng để lấy token hợp lệ và bypass CSRF protection.
// Vì vậy:
//   - NODE_ENV === 'production' → trả 404 (coi như route không tồn tại)
//   - Ngược lại → trả JSON { csrfToken }
//
// Lưu ý: Trả 404 thay vì 403 để không vô tình xác nhận route có tồn tại.
router.get('/csrf-token', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not Found' });
    }
    res.json({ csrfToken: res.locals.csrfToken });
});

module.exports = router;
