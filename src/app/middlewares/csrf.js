const { doubleCsrf } = require('csrf-csrf');

// Bắt buộc có CSRF_SECRET — fail fast khi thiếu (tránh quên khi deploy production)
const CSRF_SECRET = process.env.CSRF_SECRET;
if (!CSRF_SECRET) {
    throw new Error('Thiếu CSRF_SECRET trong .env');
}

// Cấu hình CSRF protection dùng cookie httpOnly + token trong body/header.
// - Cookie `_csrf` lưu secret (httpOnly, sameSite lax) — không đọc được từ JS.
// - Token được sinh mỗi request, đưa vào res.locals.csrfToken để view render
//   vào form (input hidden) hoặc fetch (header x-csrf-token).
// Quan trọng: thư viện csrf-csrf mặc định CHỈ đọc token từ header
// `x-csrf-token` (xem src của dist/index.cjs dòng getCsrfTokenFromRequest).
// Với form HTML submit token nằm trong BODY (field _csrf) → phải chỉ định
// đọc cả body nếu không form luôn bị 403 dù token khớp cookie.
const { invalidCsrfTokenError, generateCsrfToken, doubleCsrfProtection } =
    doubleCsrf({
        getSecret: () => CSRF_SECRET,
        // Dự án dùng cookie-based (không express-session) — secret nằm trong
        // cookie httpOnly `_csrf`, nên identifier cố định là đủ an toàn.
        getSessionIdentifier: () => 'v-connect-session',
        getCsrfTokenFromRequest: (req) =>
            (req.body && req.body._csrf) || req.headers['x-csrf-token'],
        cookieName: '_csrf',
        cookieOptions: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
        },
        size: 64,
        ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    });

// Middleware: gắn token vào res.locals để view dùng được
function csrfToken(req, res, next) {
    res.locals.csrfToken = generateCsrfToken(req, res);
    next();
}

// Middleware: chặn request không có token hợp lệ
function csrfProtection(req, res, next) {
    doubleCsrfProtection(req, res, (err) => {
        if (err === invalidCsrfTokenError) {
            return res.status(403).json({ error: 'Token CSRF không hợp lệ' });
        }
        next(err);
    });
}

module.exports = { csrfToken, csrfProtection };
