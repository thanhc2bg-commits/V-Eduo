require('dotenv').config();
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const YT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
function makeYoutubeId(prefix, index) {
    const suffix = index.toString(36).padStart(6, '0');
    let id = String(prefix).charAt(0) + suffix;
    while (id.length < 11) {
        id += YT_CHARS[Math.floor(Math.random() * YT_CHARS.length)];
    }
    return id;
}

async function main() {
    const jar = new CookieJar();
    const c = wrapper(
        axios.create({
            baseURL: BASE_URL,
            jar,
            withCredentials: true,
            maxRedirects: 0,
            validateStatus: () => true,
        }),
    );

    // Lấy CSRF token
    const csrf = (await c.get('/dev/csrf-token')).data.csrfToken;
    // Đăng nhập
    const login = await c.post(
        '/auth/login',
        { identifier: ADMIN_USERNAME, password: ADMIN_PASSWORD },
        { headers: { 'x-csrf-token': csrf } },
    );
    console.log('Login status:', login.status);

    // Tạo items hợp lệ
    const items = [];
    for (let i = 0; i < 5; i++) {
        items.push({
            youtubeId: makeYoutubeId('n', i),
            title: 'SB4E Video ' + i,
        });
    }

    const headers = { 'Content-Type': 'application/json', 'x-csrf-token': csrf };

    // Gửi 2 request đồng thời SAME items
    const [r1, r2] = await Promise.all([
        c.post('/courses/playlist/store', { items }, { headers }),
        c.post('/courses/playlist/store', { items }, { headers }),
    ]);
    console.log('Request 1 status:', r1.status);
    console.log('Request 2 status:', r2.status);
    console.log('Request 2 body:', JSON.stringify(r2.data));
    console.log('done');
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});