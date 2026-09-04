const cors = require('cors');

// CORS whitelist — chỉ cho phép origin trong danh sách (từ CORS_ORIGINS env, phân tách bằng dấu phẩy).
// Nếu CORS_ORIGINS trống hoặc '*', cho phép tất cả (dùng cho dev/local).
function normalizeOrigin(value) {
    if (value === '*') return value;

    try {
        return new URL(value).origin;
    } catch (error) {
        return value;
    }
}

const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

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
    let normalizedOrigin = origin;
    try {
        const originUrl = new URL(origin);
        originHost = originUrl.host;
        normalizedOrigin = originUrl.origin;
    } catch (e) {
        originHost = null;
    }

    // Render và các reverse proxy có thể thay Host nội bộ nhưng giữ host công
    // khai trong X-Forwarded-Host. Ưu tiên header này khi nhận diện same-origin.
    const forwardedHost = req.headers['x-forwarded-host'];
    const requestHost =
        (typeof forwardedHost === 'string' && forwardedHost.split(',')[0].trim()) ||
        req.headers.host;

    if (originHost && requestHost && originHost === requestHost) {
        return callback(null, {
            origin: true,
            credentials: true,
            maxAge: 86400,
        });
    }

    // CORS chỉ quản lý request JavaScript giữa các origin, không được chặn
    // người dùng điều hướng trực tiếp tới trang HTML từ một website khác.
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    const isPageNavigation =
        req.method === 'GET' &&
        (req.headers['sec-fetch-mode'] === 'navigate' || acceptsHtml);
    if (isPageNavigation) {
        return callback(null, { origin: false });
    }

    // Chỉ dev/local mới được phép dùng wildcard. Production mặc định từ chối
    // cross-origin nếu chưa cấu hình whitelist; same-origin vẫn được phép ở trên.
    if (
        process.env.NODE_ENV !== 'production' &&
        (!origins.length || origins.includes('*'))
    ) {
        return callback(null, {
            origin: true,
            credentials: true,
            maxAge: 86400,
        });
    }

    // Origin khác host — chỉ cho phép nếu nằm trong whitelist
    if (origins.includes(normalizedOrigin)) {
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
