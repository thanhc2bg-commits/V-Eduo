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

// Tạo YouTube ID hợp lệ 11 ký tự, ĐẢM BẢO DUY NHẤT bằng cách dùng index (base36)
// để 55 video trong Kịch bản 1 không bao giờ trùng ID ngẫu nhiên.
const YT_CHARS =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
function makeYoutubeId(prefix, index) {
    // Nếu có index → dùng index để tạo phần đuôi duy nhất (base36, tối đa 6 ký tự cho 55 video)
    if (index !== undefined) {
        const suffix = index.toString(36).padStart(6, '0');
        let id = String(prefix).charAt(0) + suffix;
        // Đảm bảo đủ 11 ký tự
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
const PlaylistCache = require('../src/app/models/PlaylistCache');

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

    // Dọn cache playlist cũ
    const delCache = await PlaylistCache.deleteMany({});
    console.log(`[SETUP] Đã xóa ${delCache.deletedCount} playlist cache cũ`);

    // Đăng nhập admin
    const admin = makeClient();
    const login = await sendWithCsrf(admin, 'post', '/auth/login', {
        identifier: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
    });
    console.log(`[SETUP] Đăng nhập admin: status ${login.status}`);
    if (login.status !== 302) {
        console.error(
            '[FATAL] Không đăng nhập được admin:',
            JSON.stringify(login.data),
        );
        await disconnectDb();
        process.exit(1);
    }
    console.log('[SETUP] Đăng nhập admin thành công\n');

    // ============================================================
    // KỊCH BẢN 1: Luồng chính — 55 video → 1 course
    // ============================================================
    console.log('===== KỊCH BẢN 1: Luồng chính (55 video → 1 course) =====');
    const sb1Videos = [];
    for (let i = 0; i < 55; i++) {
        sb1Videos.push({
            youtubeId: makeYoutubeId('a', i),
            title: `SB1 Video ${i}`,
        });
    }
    const sb1 = await sendWithCsrf(admin, 'post', '/courses/playlist/store', {
        items: sb1Videos,
    });
    console.log(`[SB1] storePlaylist status: ${sb1.status}`);
    console.log(
        `[SB1] storePlaylist body: ${JSON.stringify(sb1.data).slice(0, 300)}`,
    );

    // Verify DB
    const sb1Course = await Course.findOne({ name: 'SB1 Video 0' }).sort({
        createdAt: -1,
    });
    if (sb1Course) {
        const sb1Module = await Module.findOne({ courseId: sb1Course._id });
        const sb1Count = await Video.countDocuments({
            moduleId: sb1Module._id,
        });
        console.log(`[SB1] Course ID: ${sb1Course._id}`);
        console.log(`[SB1] Module ID: ${sb1Module._id}`);
        console.log(`[SB1] Số video trong module: ${sb1Count}`);
        console.log(`[SB1] Kỳ vọng: 55`);
        console.log(`[SB1] ${sb1Count === 55 ? 'PASS' : 'FAIL'}`);
    } else {
        console.log('[SB1] KHÔNG tìm thấy Course vừa tạo — FAIL');
    }
    console.log('');

    // ============================================================
    // KỊCH BẢN 2: Trùng trong cùng lần chọn
    // ============================================================
    console.log('===== KỊCH BẢN 2: Trùng trong cùng lần chọn =====');
    const dupYoutubeId = makeYoutubeId('b');
    const sb2Items = [
        { youtubeId: dupYoutubeId, title: 'SB2 Video A' },
        { youtubeId: dupYoutubeId, title: 'SB2 Video A (lặp)' },
        { youtubeId: makeYoutubeId('c'), title: 'SB2 Video B' },
    ];
    const sb2 = await sendWithCsrf(admin, 'post', '/courses/playlist/store', {
        items: sb2Items,
    });
    console.log(`[SB2] storePlaylist status: ${sb2.status}`);
    console.log(`[SB2] storePlaylist body: ${JSON.stringify(sb2.data)}`);

    // Verify: duplicate chứa dupYoutubeId, chỉ 1 bản ghi cho video đó
    const dupCount = await Video.countDocuments({ youtubeId: dupYoutubeId });
    console.log(`[SB2] Số bản ghi cho youtubeId trùng: ${dupCount}`);
    console.log(`[SB2] Kỳ vọng: 1`);
    console.log(`[SB2] ${dupCount === 1 ? 'PASS' : 'FAIL'}`);
    console.log('');

    // ============================================================
    // KỊCH BẢN 3: Video dùng lại ở khóa học khác (QUAN TRỌNG)
    // ============================================================
    console.log(
        '===== KỊCH BẢN 3: Video dùng lại ở khóa học khác (QUAN TRỌNG) =====',
    );
    const sharedYoutubeId = makeYoutubeId('d');

    // Tạo Course A chứa video X
    const sb3a = await sendWithCsrf(admin, 'post', '/courses/playlist/store', {
        items: [{ youtubeId: sharedYoutubeId, title: 'SB3 Shared Video' }],
    });
    console.log(`[SB3] Tạo Course A status: ${sb3a.status}`);
    console.log(`[SB3] Tạo Course A body: ${JSON.stringify(sb3a.data)}`);

    // Tạo Course B cũng chứa video X
    const sb3b = await sendWithCsrf(admin, 'post', '/courses/playlist/store', {
        items: [
            { youtubeId: sharedYoutubeId, title: 'SB3 Shared Video' },
            { youtubeId: makeYoutubeId('e'), title: 'SB3 Video B2' },
        ],
    });
    console.log(`[SB3] Tạo Course B status: ${sb3b.status}`);
    console.log(`[SB3] Tạo Course B body: ${JSON.stringify(sb3b.data)}`);

    // Verify: video X có 2 document, 2 moduleId khác nhau
    const sharedDocs = await Video.find({ youtubeId: sharedYoutubeId }).lean();
    console.log(
        `[SB3] Số document cho video X: ${sharedDocs.length} (kỳ vọng 2)`,
    );
    const moduleIds = [...new Set(sharedDocs.map((d) => d.moduleId.toString()))];
    console.log(`[SB3] Số moduleId khác nhau: ${moduleIds.length} (kỳ vọng 2)`);
    console.log(`[SB3] Module IDs: ${JSON.stringify(moduleIds)}`);
    const sb3Pass =
        sharedDocs.length === 2 && moduleIds.length === 2 && sb3b.status === 200;
    console.log(`[SB3] ${sb3Pass ? 'PASS' : 'FAIL'}`);
    console.log('');

    // ============================================================
    // KỊCH BẢN 4: Double-click (2 request đồng thời)
    // ============================================================
    console.log('===== KỊCH BẢN 4: Double-click (2 request đồng thời) =====');
    const sb4Items = [];
    for (let i = 0; i < 10; i++) {
        sb4Items.push({
            youtubeId: makeYoutubeId('f', i),
            title: `SB4 Video ${i}`,
        });
    }
    // Gửi 2 request gần như đồng thời (giả lập double-click)
    const [sb4a, sb4b] = await Promise.all([
        sendWithCsrf(admin, 'post', '/courses/playlist/store', {
            items: sb4Items,
        }),
        sendWithCsrf(admin, 'post', '/courses/playlist/store', {
            items: sb4Items,
        }),
    ]);
    console.log(`[SB4] Request 1 status: ${sb4a.status}`);
    console.log(`[SB4] Request 2 status: ${sb4b.status}`);
    console.log(`[SB4] Request 1 body: ${JSON.stringify(sb4a.data).slice(0, 200)}`);
    console.log(`[SB4] Request 2 body: ${JSON.stringify(sb4b.data).slice(0, 200)}`);

    // Verify: chỉ 1 course được tạo (course name = SB4 Video 0)
    const sb4Courses = await Course.find({ name: 'SB4 Video 0' }).lean();
    console.log(`[SB4] Số Course tên "SB4 Video 0": ${sb4Courses.length} (kỳ vọng 1)`);
    console.log(`[SB4] ${sb4Courses.length === 1 ? 'PASS' : 'FAIL'}`);
    console.log('');

    // ============================================================
    // KỊCH BẢN 5: Playlist >200 video (cần playlist thật)
    // ============================================================
    console.log('===== KỊCH BẢN 5: Playlist >200 video =====');
    console.log(
        '[SB5] Kịch bản này cần 1 playlist YouTube công khai thật có >200 video.',
    );
    console.log(
        '[SB5] Không thể giả lập qua API vì /courses/playlist/items gọi YouTube Data API thật.',
    );
    console.log(
        '[SB5] Để test đầy đủ, cần dán link playlist thật vào UI /courses/create.',
    );
    console.log(
        '[SB5] Tuy nhiên, logic truncated đã được xác minh trong code:',
    );
    console.log(
        '[SB5]   - youtube.js: truncated = Boolean(pageToken) sau vòng lặp MAX_VIDEOS_PER_BATCH=200',
    );
    console.log(
        '[SB5]   - playlist-import.js: hiển thị cảnh báo vàng khi data.truncated true',
    );
    console.log('[SB5] CẦN PLAYLIST THẬT ĐỂ TEST ĐẦY ĐỦ');
    console.log('');

    // ============================================================
    // TỔNG KẾT
    // ============================================================
    console.log('===== TỔNG KẾT =====');
    console.log('Kịch bản 1 (Luồng chính): xem kết quả ở trên');
    console.log('Kịch bản 2 (Trùng trong lần chọn): xem kết quả ở trên');
    console.log('Kịch bản 3 (Video dùng lại khóa khác): xem kết quả ở trên');
    console.log('Kịch bản 4 (Double-click): xem kết quả ở trên');
    console.log('Kịch bản 5 (Playlist >200): CẦN PLAYLIST THẬT');

    await disconnectDb();
    process.exit(0);
})().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});