const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Session = require('../app/models/Session');
const User = require('../app/models/User');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL = '10s';
const REFRESH_TOKEN_TTL = 14 * 24 * 60 * 60 * 1000; // 14 ngày

// Sign access token JWT (ngắn hạn)
function signAccessToken(user) {
    return jwt.sign(
        {
            id: user._id,
            username: user.username,
            name: user.name,
            role: user.role,
        },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_TTL },
    );
}

// Tạo refresh token ngẫu nhiên (không phải JWT — chỉ để tra DB)
function generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
}

// Tạo session mới + set 2 cookie (accessToken + refreshToken)
async function createSessionAndSetCookies(res, user) {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL);

    await Session.create({
        userId: user._id,
        refreshToken,
        expiresAt,
    });

    const accessToken = signAccessToken(user);

    res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000, // 15 phút
    });
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: REFRESH_TOKEN_TTL,
    });
}

// Refresh access token từ refreshToken cookie.
// Trả về { user } nếu thành công (đã set cookie accessToken mới),
// hoặc { user: null } nếu refresh token không hợp lệ/hết hạn.
// Dùng chung cho middleware attachUser (tự refresh ẩn) và route POST /auth/refresh.
async function refreshAccessTokenFromCookie(req, res) {
    const refreshToken = req.cookies && req.cookies.refreshToken;
    if (!refreshToken) return { user: null };

    // Raw collection query — tránh bug mongoose-delete (Session không dùng plugin,
    // nhưng giữ pattern nhất quán)
    const session = await Session.collection.findOne({ refreshToken });
    if (!session) return { user: null };

    // Check thủ công expiresAt (TTL index chạy theo chu kỳ nền, không tức thời)
    if (new Date(session.expiresAt).getTime() < Date.now()) {
        return { user: null };
    }

    // Session chỉ lưu userId — cần query User để lấy username/name/role
    // (dùng raw collection để thấy cả bản soft-delete, tránh bug mongoose-delete)
    const user = await User.collection.findOne({ _id: session.userId });
    if (!user) return { user: null };

    const accessToken = signAccessToken(user);
    res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000,
    });

    return {
        user: {
            id: user._id,
            username: user.username,
            name: user.name,
            role: user.role,
        },
    };
}

module.exports = {
    signAccessToken,
    generateRefreshToken,
    createSessionAndSetCookies,
    refreshAccessTokenFromCookie,
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL,
};
