const rateLimit = require('express-rate-limit');

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

module.exports = { authLimiter, apiLimiter };
