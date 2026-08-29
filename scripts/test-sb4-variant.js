require('dotenv').config();
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const mongoose = require('mongoose');

// ============================================================
// CẤU HÌNH
// ============================================================
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('[FATAL] Thiếu ADMIN_USERNAME / ADMIN_PASSWORD trong .env');
    process.exit(1);
}

// ============================================================
// CLIENT + HELPERS
// ============================================================
function makeClient() {
    const jar = new CookieJar();
    const instance = wrapper(
        axios.create({
            baseURL: BASE_URL,
            jar,
            withCredentials: true,
            maxRedirects: 0,
            validateStatus: () => true,
        }),
    );
    return { instance, jar };
}

async function getCsrf(client) {
    const res = await client.instance.get('/dev/csrf-token');
    return res.data && res.data.csrfToken;
}

async function send(client, method, url, body, headers = {}) {
    try {
        const res = await client.instance.request({
            method,
            url,
            data: body,
            headers,
        });
        return { status: res.status, data: res.data };
    } catch (err) {
        if (err.response) {
            return { status: err.response.status, data: err.response.data };
        }
        return { status: 0, data: err.message };
    }
}

async function sendWithCsrf(client, method, url, body) {
    const token = await getCsrf(client);
    return send(client, method, url, body, { 'x-csrf-token': token });
}

// Tạo YouTube ID hợp lệ 11 ký tự, đảm bảo duy nhất bằng index
const YT_CHARS =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
function makeYoutubeId(prefix, index) {
    if (index !== undefined) {
        const suffix = index.toString(36).padStart(6, '0');
        let id = String(prefix).charAt(0) + suffix;
        while (id.length < 11) {
            id += YT_CHARS[Math.floor(Math.random() * YT_CHARS.length)];
        }
        return id;
    }
    let id = String(prefix).charAt(0);
    while (id.length < 11) {
        id += YT_CHARS[Math.floor(Math.random() * YT_CHARS.length)];
    }
    return id;
}

// ============================================================
// DB MODELS
// ============================================================
const Course = require('../src/app/models/Course');
const Module = require('../src/app/models/Module');
const Video = require('../src/app/models/Video');

async function connectDb() {
    await mongoose.connect(MONGODB_URI);
}
async function disconnectDb() {
    await mongoose.disconnect();
}

// ============================================================
// MAIN
// ============================================================
(async () => {
    await connectDb();

    // Đăng nhập admin
    const admin = makeClient();
    const login = await sendWithCsrf(admin, 'post', '/auth/login', {
        identifier: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
    });
    console.log(`[SETUP] Đăng nhập admin: status ${login.status}`);
    if (login.status !== 302) {
        console.error('[FATAL] Không đăng nhập được admin:', JSON.stringify(login.data));
        await disconnectDb();
        process.exit(1);
    }
    console.log('[SETUP] Đăng nhập admin thành công\n');

    // ============================================================
    // PHẦN A: Kịch bản 4 gốc — 2 request đồng thời SAME items
    // ============================================================
    console.log('===== PHẦN A: Kịch bản 4 — 2 request đồng thời SAME items =====');
    const sb4Items = [];
    for (let i = 0; i < 10; i++) {
        sb4Items.push({
            youtubeId: makeYoutubeId('g', i),
            title: `SB4B Video ${i}`,
        });
    }
    const [saA, saB] = await Promise.all([
        sendWithCsrf(admin, 'post', '/courses/playlist/store', { items: sb4Items }),
        sendWithCsrf(admin, 'post', '/courses/playlist/store', { items: sb4Items }),
    ]);
    console.log(`[A] Request 1 status: ${saA.status}`);
    console.log(`[A] Request 2 status: ${saB.status}`);
    console.log(`[A] Request 1 body: ${JSON.stringify(saA.data).slice(0, 300)}`);
    console.log(`[A] Request 2 body: ${JSON.stringify(saB.data).slice(0, 300)}`);

    // Verify: số Course tên "SB4B Video 0"
    const coursesA = await Course.find({ name: 'SB4B Video 0' }).lean();
    console.log(`[A] Số Course tên "SB4B Video 0": ${coursesA.length}`);
    console.log('');

    // ============================================================
    // PHẦN B: Biến thể — 2 request đồng thời, video đầu KHÁC nhau
    // ============================================================
    console.log('===== PHẦN B: 2 request đồng thời, video đầu KHÁC nhau =====');
    // Request 1: video đầu = title "SB4C First Video 1" (slug: sb4c-first-video-1)
    // Request 2: video đầu = title "SB4C First Video 2" (slug: sb4c-first-video-2)
    // Các video còn lại dùng chung để giả lập cùng playlist nhưng thứ tự khác.
    const itemsB1 = [
        { youtubeId: makeYoutubeId('h', 0), title: 'SB4C First Video 1' },
        { youtubeId: makeYoutubeId('i', 1), title: 'SB4C Common 1' },
        { youtubeId: makeYoutubeId('i', 2), title: 'SB4C Common 2' },
        { youtubeId: makeYoutubeId('i', 3), title: 'SB4C Common 3' },
    ];
    const itemsB2 = [
        { youtubeId: makeYoutubeId('j', 0), title: 'SB4C First Video 2' },
        { youtubeId: makeYoutubeId('i', 1), title: 'SB4C Common 1' },
        { youtubeId: makeYoutubeId('i', 2), title: 'SB4C Common 2' },
        { youtubeId: makeYoutubeId('i', 3), title: 'SB4C Common 3' },
    ];
    const [sbB1, sbB2] = await Promise.all([
        sendWithCsrf(admin, 'post', '/courses/playlist/store', { items: itemsB1 }),
        sendWithCsrf(admin, 'post', '/courses/playlist/store', { items: itemsB2 }),
    ]);
    console.log(`[B] Request 1 status: ${sbB1.status}`);
    console.log(`[B] Request 2 status: ${sbB2.status}`);
    console.log(`[B] Request 1 body: ${JSON.stringify(sbB1.data).slice(0, 300)}`);
    console.log(`[B] Request 2 body: ${JSON.stringify(sbB2.data).slice(0, 300)}`);

    // Verify: số Course có name bắt đầu "SB4C"
    const coursesB = await Course.find({ name: /^SB4C/ }).lean();
    console.log(`[B] Số Course có name bắt đầu "SB4C": ${coursesB.length}`);
    coursesB.forEach((c) => {
        console.log(`[B]   - ${c.name} (slug: ${c.slug}, id: ${c._id})`);
    });

    // Verify: video chung "SB4C Common 1" có bao nhiêu document?
    const common1Id = itemsB1[1].youtubeId;
    const commonDocs = await Video.find({ youtubeId: common1Id }).lean();
    console.log(`[B] Số document cho ${common1Id}: ${commonDocs.length}`);
    console.log('');

    // ============================================================
    // TỔNG KẾT
    // ============================================================
    console.log('===== TỔNG KẾT =====');
    console.log('Phần A (2 request same items): xem ở trên');
    console.log('Phần B (2 request khác video đầu): xem ở trên');

    await disconnectDb();
    process.exit(0);
})().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});