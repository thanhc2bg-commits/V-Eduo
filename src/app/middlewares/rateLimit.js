const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Helper: khóa rate-limit theo userId — áp dụng cho route đã qua requireAuth.
// (Tránh false-positive khi nhiều user dùng chung IP/NAT; tránh né bằng đổi IP.)
// Fallback về IP phải dùng ipKeyGenerator() để xử lý IPv6 đúng (tránh ERR_ERL_KEY_GEN_IPV6).
function userKeyGenerator(req) {
    return req.user && req.user.id
        ? `user:${req.user.id}`
        : ipKeyGenerator(req);
}

// Giới hạn cho các route xác thực (login/register/refresh) — chống brute-force.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 10, // tối đa 10 request / IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Quá nhiều lần thử. Vui lòng thử lại sau 15 phút.' },
});

// Giới hạn cho các route gọi YouTube API (playlist) — chống spam.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});

// Giới hạn ghi nhận xem video — theo userId (route đã qua requireAuth).
const watchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 30, // tối đa 30 request / user / phút
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});

// Giới hạn đánh dấu hoàn thành / bỏ hoàn thành video — theo userId.
// (Phase 2 — áp dụng cho POST/DELETE /api/videos/:videoId/complete)
const progressLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 30, // tối đa 30 request / user / phút
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});

// Giới hạn ghi chú — theo userId (Phase 2). Để sẵn để dùng khi triển khai Note.
const noteLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 10, // tối đa 10 ghi chú / user / phút
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});

// Giới hạn đánh giá — theo userId (Phase 3). Để sẵn để dùng khi triển khai Review.
const reviewLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 giờ
    max: 10, // tối đa 10 đánh giá / user / giờ
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});

// Giới hạn trang chứng chỉ public — theo IP (route public, chưa có user).
const certificateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 60, // tối đa 60 request / IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});

module.exports = {
    authLimiter,
    apiLimiter,
    watchLimiter,
    progressLimiter,
    noteLimiter,
    reviewLimiter,
    certificateLimiter,
};
