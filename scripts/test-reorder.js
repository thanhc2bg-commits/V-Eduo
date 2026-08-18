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

// ============================================================
// KHỞI TẠO 2 COOKIE JAR RIÊNG BIỆT (owner, other)
// ============================================================
function makeClient() {
    const jar = new CookieJar();
    const client = wrapper(
        axios.create({
            baseURL: BASE_URL,
            jar,
            withCredentials: true,
            maxRedirects: 0,
            validateStatus: () => true,
        }),
    );
    return { client, jar };
}

const owner = makeClient();
const other = makeClient();

// ============================================================
// HELPERS
// ============================================================
const results = [];
let passCount = 0;
let failCount = 0;

function record(name, pass, detail) {
    if (pass) {
        passCount++;
        console.log(`[PASS] ${name}`);
    } else {
        failCount++;
        console.log(`[FAIL] ${name}`);
        if (detail !== undefined) {
            console.log(`       ${JSON.stringify(detail)}`);
        }
    }
    results.push({ name, pass });
}

async function send(client, method, url, body, headers = {}) {
    try {
        const res = await client.request({
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

async function getCsrf(client) {
    const res = await client.get('/dev/csrf-token');
    return res.data && res.data.csrfToken;
}

async function sendWithCsrf(client, method, url, body) {
    const token = await getCsrf(client);
    return send(client, method, url, body, { 'x-csrf-token': token });
}

async function ensureUser(client, { name, username, email, password }) {
    let res = await sendWithCsrf(client, 'post', '/auth/register', {
        name,
        username,
        email,
        password,
    });
    if (res.status === 302) {
        return { created: true };
    }
    res = await sendWithCsrf(client, 'post', '/auth/login', {
        identifier: username,
        password,
    });
    if (res.status === 302) {
        return { created: false };
    }
    return { created: false, error: res };
}

const YT_CHARS =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
function makeYoutubeId(prefix) {
    let id = String(prefix).charAt(0);
    while (id.length < 11) {
        id += YT_CHARS[Math.floor(Math.random() * YT_CHARS.length)];
    }
    return id;
}

// ============================================================
// KẾT NỐI DB
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
    console.log('===== TEST REORDER — BẮT ĐẦU =====\n');

    // ---------- SETUP ----------
    console.log('--- SETUP ---');

    // 1. Đăng nhập 2 user
    const ownerUser = {
        name: 'Reorder Owner',
        username: 'reorder_owner',
        email: 'reorder_owner@test.com',
        password: '12345678',
    };
    const otherUser = {
        name: 'Reorder Other',
        username: 'reorder_other',
        email: 'reorder_other@test.com',
        password: '12345678',
    };
    const regOwner = await ensureUser(owner.client, ownerUser);
    const regOther = await ensureUser(other.client, otherUser);
    record('Setup: đăng nhập owner', !regOwner.error, regOwner.error || {});
    record('Setup: đăng nhập other', !regOther.error, regOther.error || {});

    // 2. Tạo Course
    const courseVideoid = makeYoutubeId('r');
    const courseName = `Reorder Test ${Date.now()}`;
    const storeCourse = await sendWithCsrf(owner.client, 'post', '/courses/store', {
        name: courseName,
        videoid: courseVideoid,
        description: 'Reorder test course',
    });
    record('Setup: tạo Course', storeCourse.status === 302, storeCourse.data);

    const courseDoc = await Course.findOne({ videoid: courseVideoid });
    const courseId = courseDoc ? courseDoc._id.toString() : null;
    record('Setup: lấy courseId', !!courseId, { courseId });

    // 3. Tạo 3 Module
    const moduleNames = ['Module A', 'Module B', 'Module C'];
    const moduleIds = [];
    for (const name of moduleNames) {
        const res = await sendWithCsrf(owner.client, 'post', `/courses/${courseId}/modules`, { name });
        if (res.status === 201 && res.data && res.data.module) {
            moduleIds.push(res.data.module._id);
        } else {
            record(`Setup: tạo ${name}`, false, res.data);
        }
    }
    record('Setup: tạo 3 Module', moduleIds.length === 3, { moduleIds });

    // 4. Query thứ tự gốc
    let modules = await Module.find({ courseId }).sort({ order: 1 });
    console.log('\nThứ tự gốc (từ DB):');
    modules.forEach((m) => console.log(`  - ${m.name} (${m._id}) order=${m.order}`));

    // ---------- TEST 1: Reorder hợp lệ, đảo ngược ----------
    console.log('\n--- TEST 1: Reorder hợp lệ (đảo ngược C, B, A) ---');
    const reversedIds = [...moduleIds].reverse();
    const t1 = await sendWithCsrf(owner.client, 'put', `/courses/${courseId}/modules/reorder`, {
        orderedIds: reversedIds,
    });
    record('T1: PUT reorder trả 200', t1.status === 200, t1.data);
    const t1Modules = (t1.data && t1.data.modules) || [];
    const t1Order = t1Modules.map((m) => m._id);
    record('T1: response đúng thứ tự C,B,A', JSON.stringify(t1Order) === JSON.stringify(reversedIds), { t1Order, reversedIds });

    // 7. Query DB xác nhận order
    modules = await Module.find({ courseId }).sort({ order: 1 });
    const dbOrder = modules.map((m) => m._id.toString());
    record('T1: DB order đúng 0,1,2', JSON.stringify(dbOrder) === JSON.stringify(reversedIds), { dbOrder, reversedIds });

    // ---------- TEST 2: orderedIds thiếu 1 ID ----------
    console.log('\n--- TEST 2: orderedIds thiếu 1 ID (phải 400) ---');
    const missingOne = moduleIds.slice(0, 2); // chỉ 2/3
    const t2 = await sendWithCsrf(owner.client, 'put', `/courses/${courseId}/modules/reorder`, {
        orderedIds: missingOne,
    });
    const t2Msg = (t2.data && t2.data.error) || '';
    record('T2: trả 400', t2.status === 400, t2.data);
    record('T2: message chứa "không khớp"', t2Msg.includes('không khớp'), t2Msg);

    // 9. Xác nhận DB không đổi
    modules = await Module.find({ courseId }).sort({ order: 1 });
    const dbOrderAfterT2 = modules.map((m) => m._id.toString());
    record('T2: DB không đổi', JSON.stringify(dbOrderAfterT2) === JSON.stringify(reversedIds), { dbOrderAfterT2, reversedIds });

    // ---------- TEST 3: User khác gọi reorder (phải 403) ----------
    console.log('\n--- TEST 3: User khác gọi reorder (phải 403) ---');
    const t3 = await sendWithCsrf(other.client, 'put', `/courses/${courseId}/modules/reorder`, {
        orderedIds: reversedIds,
    });
    record('T3: trả 403', t3.status === 403, t3.data);

    // ---------- TEST 4: Video reorder ----------
    console.log('\n--- TEST 4: Video reorder ---');

    // 11. Tạo 3 Video trong Module A (moduleIds[0])
    const moduleAId = moduleIds[0];
    const videoYoutubeIds = ['dQw4w9WgXcQ', 'abc12345678', 'xyz98765432'];
    const videoIds = [];
    for (let i = 0; i < 3; i++) {
        const res = await sendWithCsrf(owner.client, 'post', `/modules/${moduleAId}/videos`, {
            youtubeId: videoYoutubeIds[i],
            title: `Video ${i + 1}`,
        });
        if (res.status === 201 && res.data && res.data.video) {
            videoIds.push(res.data.video._id);
        } else {
            record(`Setup: tạo Video ${i + 1}`, false, res.data);
        }
    }
    record('Setup: tạo 3 Video', videoIds.length === 3, { videoIds });

    // 12a. Test 1 cho Video: đảo ngược
    const videoReversed = [...videoIds].reverse();
    const t4a = await sendWithCsrf(owner.client, 'put', `/modules/${moduleAId}/videos/reorder`, {
        orderedIds: videoReversed,
    });
    record('T4a: PUT video reorder trả 200', t4a.status === 200, t4a.data);
    const t4aVideos = (t4a.data && t4a.data.videos) || [];
    const t4aOrder = t4aVideos.map((v) => v._id);
    record('T4a: response đúng thứ tự đảo', JSON.stringify(t4aOrder) === JSON.stringify(videoReversed), { t4aOrder, videoReversed });

    let videos = await Video.find({ moduleId: moduleAId }).sort({ order: 1 });
    const dbVideoOrder = videos.map((v) => v._id.toString());
    record('T4a: DB video order đúng', JSON.stringify(dbVideoOrder) === JSON.stringify(videoReversed), { dbVideoOrder, videoReversed });

    // 12b. Test 2 cho Video: thiếu 1 ID
    const videoMissing = videoIds.slice(0, 2);
    const t4b = await sendWithCsrf(owner.client, 'put', `/modules/${moduleAId}/videos/reorder`, {
        orderedIds: videoMissing,
    });
    const t4bMsg = (t4b.data && t4b.data.error) || '';
    record('T4b: video thiếu ID trả 400', t4b.status === 400, t4b.data);
    record('T4b: message chứa "không khớp"', t4bMsg.includes('không khớp'), t4bMsg);

    videos = await Video.find({ moduleId: moduleAId }).sort({ order: 1 });
    const dbVideoAfterT4b = videos.map((v) => v._id.toString());
    record('T4b: DB video không đổi', JSON.stringify(dbVideoAfterT4b) === JSON.stringify(videoReversed), { dbVideoAfterT4b, videoReversed });

    // 12c. Test 3 cho Video: user khác gọi
    const t4c = await sendWithCsrf(other.client, 'put', `/modules/${moduleAId}/videos/reorder`, {
        orderedIds: videoReversed,
    });
    record('T4c: user khác video reorder trả 403', t4c.status === 403, t4c.data);

    // ---------- CLEANUP ----------
    console.log('\n--- CLEANUP ---');
    try {
        if (courseId) {
            // Xóa cứng Video, Module, Course
            const mods = await Module.find({ courseId }).select('_id');
            const modIds = mods.map((m) => m._id);
            if (modIds.length > 0) {
                await Video.deleteMany({ moduleId: { $in: modIds } });
            }
            await Module.deleteMany({ courseId });
            await Course.deleteOne({ _id: courseId });
            console.log('[CLEANUP] Đã xóa cứng Course/Module/Video test');
        }
    } catch (cleanupErr) {
        console.log(`[CLEANUP] Lỗi khi dọn dẹp: ${cleanupErr.message}`);
    }

    // ---------- TỔNG KẾT ----------
    console.log('\n===== TỔNG KẾT =====');
    console.log(`Tổng số bước: ${results.length}`);
    console.log(`PASS: ${passCount}`);
    console.log(`FAIL: ${failCount}`);
    console.log(`Kết quả: ${passCount}/${results.length} PASS`);

    await disconnectDb();
    process.exit(failCount > 0 ? 1 : 0);
})().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});