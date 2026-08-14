const jwt = require('jsonwebtoken');
const { refreshAccessTokenFromCookie } = require('../../utils/token');

const JWT_SECRET = process.env.JWT_SECRET;

// Gắn req.user từ cookie accessToken — chạy toàn cục, không chặn nếu thiếu/hỏng.
// Nếu access token hết hạn, tự refresh 1 lần (dùng refreshToken cookie) để
// người dùng không cảm nhận được việc token vừa được làm mới.
async function attachUser(req, res, next) {
    try {
        const token = req.cookies && req.cookies.accessToken;
        let payload = null;
        if (token) {
            try {
                payload = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                // Chỉ refresh khi token hết hạn (TokenExpiredError), không phải
                // token hỏng/không hợp lệ khác
                if (err.name === 'TokenExpiredError') {
                    const { user } = await refreshAccessTokenFromCookie(
                        req,
                        res,
                    );
                    payload = user
                        ? {
                              id: user.id,
                              username: user.username,
                              name: user.name,
                              role: user.role,
                          }
                        : null;
                } else {
                    payload = null;
                }
            }
        }
        req.user = payload
            ? {
                  id: payload.id,
                  username: payload.username,
                  name: payload.name,
                  role: payload.role,
              }
            : null;
    } catch {
        // Lỗi bất ngờ (vd DB query fail) — không crash app, coi như chưa đăng nhập
        req.user = null;
    }
    // res.locals được express-handlebars tự merge vào mọi view
    res.locals.user = req.user;
    next();
}

// Chặn nếu chưa đăng nhập
// - Request API (path /courses/playlist, hoặc Accept: application/json) → 401 JSON
// - Request trang HTML → redirect /auth/login
function requireAuth(req, res, next) {
    if (!req.user) {
        const wantsJson =
            req.path.startsWith('/courses/playlist') ||
            (req.headers.accept &&
                req.headers.accept.includes('application/json'));

        if (wantsJson) {
            return res.status(401).json({ error: 'Cần đăng nhập' });
        }
        return res.redirect('/auth/login');
    }
    next();
}

// Chạy sau requireAuth — chỉ cho phép role cụ thể
function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            const wantsJson =
                req.path.startsWith('/courses/playlist') ||
                (req.headers.accept &&
                    req.headers.accept.includes('application/json'));

            if (wantsJson) {
                return res
                    .status(403)
                    .json({ error: 'Không có quyền truy cập' });
            }
            // User đã đăng nhập nhưng thiếu quyền -> trang 403 riêng (standalone, không dùng layout)
            return res.status(403).render('errors/403', {
                layout: false,
                error: 'Bạn không có quyền truy cập trang này',
                user: req.user,
            });
        }
        next();
    };
}

module.exports = { attachUser, requireAuth, requireRole };
