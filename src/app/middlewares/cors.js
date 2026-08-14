const cors = require('cors');

// CORS whitelist — chỉ cho phép origin trong danh sách (từ CORS_ORIGINS env, phân tách bằng dấu phẩy).
// Nếu CORS_ORIGINS trống hoặc '*', cho phép tất cả (dùng cho dev/local).
const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Dùng dạng function-options để có req — cho phép same-origin LUÔN LUÔN
// (dự án server-rendered, form submit / fetch đều same-origin),
// chỉ kiểm tra whitelist khi origin là cross-origin khác host.
const corsOptionsFunction = (req, callback) => {
    // An toàn: luôn có req.headers
    const origin = req && req.headers ? req.headers.origin : null;

    // Không có origin (curl, server-to-server) → cho phép, không set CORS headers
    if (!origin) {
        return callback(null, { origin: false });
    }

    // Same-origin (origin.host === host server) → luôn cho phép
    let originHost = null;
    try {
        originHost = new URL(origin).host;
    } catch (e) {
        originHost = null;
    }
    if (originHost && req.headers.host && originHost === req.headers.host) {
        return callback(null, {
            origin: true,
            credentials: true,
            maxAge: 86400,
        });
    }

    // Whitelist rỗng hoặc '*' → cho phép tất cả (chỉ dùng khi dev/local)
    if (!origins.length || origins.includes('*')) {
        return callback(null, {
            origin: true,
            credentials: true,
            maxAge: 86400,
        });
    }

    // Origin khác host — chỉ cho phép nếu nằm trong whitelist
    if (origins.includes(origin)) {
        return callback(null, {
            origin: true,
            credentials: true,
            maxAge: 86400,
        });
    }

    return callback(new Error('Origin không được phép (CORS)'));
};

// cors() nhận function làm options → gọi với (req, callback)
const corsMiddleware = cors(corsOptionsFunction);

// Nếu origin không được phép, cors() gọi next(err) — bắt và trả 403
// thay vì để error handler tập trung trả 500.
function corsWithErrorHandling(req, res, next) {
    corsMiddleware(req, res, (err) => {
        if (err) {
            return res
                .status(403)
                .json({ error: 'Origin không được phép (CORS)' });
        }
        next();
    });
}

module.exports = corsWithErrorHandling;
