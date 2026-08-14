const User = require('../models/User');
const Session = require('../models/Session');
const {
    createSessionAndSetCookies,
    refreshAccessTokenFromCookie,
} = require('../../utils/token');
const { validateRegister, validateLogin } = require('../../utils/validators');

class AuthController {
    // [GET] /auth/register
    showRegister(req, res) {
        res.render('auth/register');
    }

    // [POST] /auth/register
    register(req, res, next) {
        const { name, username, email, password } = req.body;

        // Validate cơ bản
        const { ok, error } = validateRegister(req.body);
        if (!ok) {
            return res.render('auth/register', {
                error,
                name,
                username,
                email,
            });
        }

        // Check unique username/email — dùng raw collection để thấy cả bản
        // soft-delete (tránh lặp lại bug mongoose-delete + unique index)
        User.collection
            .findOne({
                $or: [
                    { username: String(username).trim().toLowerCase() },
                    { email: String(email).trim().toLowerCase() },
                ],
            })
            .then((existing) => {
                if (existing) {
                    const msg =
                        existing.username ===
                        String(username).trim().toLowerCase()
                            ? 'Tên đăng nhập đã tồn tại'
                            : 'Email đã tồn tại';
                    return res.render('auth/register', {
                        error: msg,
                        name,
                        username,
                        email,
                    });
                }
                const user = new User({
                    name: name.trim(),
                    username: username.trim().toLowerCase(),
                    email: email.trim().toLowerCase(),
                    password,
                    role: 'user', // mặc định user, không cho tự đăng ký admin
                });
                return user
                    .save()
                    .then((savedUser) =>
                        // Tự động đăng nhập sau khi đăng ký (giữ hành vi cũ)
                        createSessionAndSetCookies(res, savedUser).then(() =>
                            res.redirect('/'),
                        ),
                    )
                    .catch(next);
            })
            .catch(next);
    }

    // [GET] /auth/login
    showLogin(req, res) {
        res.render('auth/login');
    }

    // [POST] /auth/login
    login(req, res, next) {
        const { identifier, password } = req.body;

        const { ok, error } = validateLogin(req.body);
        if (!ok) {
            return res.render('auth/login', {
                error,
            });
        }

        const key = String(identifier).trim().toLowerCase();
        // password có select: false → phải select lại khi so sánh
        User.findOne({
            $or: [{ username: key }, { email: key }],
        })
            .select('+password')
            .then((user) => {
                if (!user) {
                    return res.render('auth/login', {
                        error: 'Sai tên đăng nhập hoặc mật khẩu',
                    });
                }
                return user
                    .comparePassword(password)
                    .then((isMatch) => {
                        if (!isMatch) {
                            return res.render('auth/login', {
                                error: 'Sai tên đăng nhập hoặc mật khẩu',
                            });
                        }
                        return createSessionAndSetCookies(res, user).then(() =>
                            res.redirect('/'),
                        );
                    })
                    .catch(next);
            })
            .catch(next);
    }

    // [POST] /auth/logout
    // Xóa session thật trong DB (thu hồi phiên) + xóa cả 2 cookie.
    // await để đảm bảo session bị xóa xong mới trả response (tránh race condition).
    async logout(req, res, next) {
        const refreshToken = req.cookies && req.cookies.refreshToken;
        if (refreshToken) {
            // Raw collection query — xóa session khỏi DB
            await Session.collection.deleteOne({ refreshToken }).catch(next);
        }
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');
        res.redirect('/');
    }

    // [POST] /auth/refresh
    // Route dự phòng/debug — middleware attachUser đã tự refresh ẩn,
    // nhưng vẫn có route riêng cho client JS chủ động gọi nếu cần.
    async refreshAccessToken(req, res) {
        const { user } = await refreshAccessTokenFromCookie(req, res);
        if (!user) {
            return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
        }
        return res.status(200).json({ ok: true });
    }
}

module.exports = new AuthController();
