const cors = require('cors');

// CORS whitelist — chỉ cho phép origin trong danh sách (từ CORS_ORIGINS env, phân tách bằng dấu phẩy).
// Nếu CORS_ORIGINS trống hoặc '*', cho phép tất cả (dùng cho dev/local).
const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const corsOptions = {
    origin(origin, callback) {
        // Không có origin (curl, same-origin, server-to-server) → cho phép
        if (!origin) {
            return callback(null, true);
        }
        // Whitelist rỗng hoặc '*' → cho phép tất cả
        if (!origins.length || origins.includes('*')) {
            return callback(null, true);
        }
        if (origins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin không được phép (CORS)'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 86400, // 24h cache preflight
};

const corsMiddleware = cors(corsOptions);

// Nếu origin không được phép, cors() gọi callback(err) — bắt và trả 403
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
