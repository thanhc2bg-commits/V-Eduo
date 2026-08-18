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

// Admin credentials — đọc từ .env (tạo qua npm run create-admin)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error(
        '[FATAL] Thiếu ADMIN_USERNAME / ADMIN_PASSWORD trong .env. Chạy "npm run create-admin" trước.',
    );
    process.exit(1);
}

// ============================================================
// KHỞI TẠO 3 COOKIE JAR RIÊNG BIỆT (user_owner, user_other, admin)
// ============================================================
function makeClient() {
    const jar = new CookieJar();
    const client = wrapper(
        axios.create({
            baseURL: BASE_URL,
            jar,
            withCredentials: true,
            maxRedirects: 0, // không follow redirect — lấy status 3xx thật
            validateStatus: () => true, // không throw với 4xx/5xx
        }),
    );
    return { client, jar };
}

const owner = makeClient();
const other = makeClient();
const admin = makeClient();

// ============================================================
// HELPERS
// ============================================================
const results = [];
const createdData = []; // để in "DỌN DẸP" cuối script

function record(name, expected, actual, data) {
    const expectedArr = Array.isArray(expected) ? expected : [expected];
    const pass = expectedArr.includes(actual);
    results.push({ name, expected: expectedArr, actual, pass, data });
    if (pass) {
        console.log(`[PASS] ${name} — status ${actual} (expected ${expectedArr.join('/')})`);
    } else {
        console.log(`[FAIL] ${name} — status ${actual} (expected ${expectedArr.join('/')})`);
        console.log(`       Response body: ${JSON.stringify(data)}`);
    }
}

// In [SKIP] — dùng khi 1 bước phụ thuộc vào ID null (không tính vào PASS/FAIL)
function skip(name, reason) {
    results.push({
        name,
        expected: ['SKIP'],
        actual: 'SKIP',
        pass: true,
        skipped: true,
        data: { reason },
    });
    console.log(`[SKIP] ${name} — ${reason}`);
}

// Gửi request, bắt lỗi redirect (3xx) để lấy status thật
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

// Lấy CSRF token mới bằng đúng jar của user
async function getCsrf(client) {
    const res = await client.get('/dev/csrf-token');
    return res.data && res.data.csrfToken;
}

// Gửi request kèm CSRF token (cho POST/PUT/PATCH/DELETE)
async function sendWithCsrf(client, method, url, body) {
    const token = await getCsrf(client);
    return send(client, method, url, body, { 'x-csrf-token': token });
}

// Đăng ký hoặc đăng nhập user (nếu đã tồn tại thì login)
async function ensureUser(client, { name, username, email, password }) {
    // Thử register
    let res = await sendWithCsrf(client, 'post', '/auth/register', {
        name,
        username,
        email,
        password,
    });
    if (res.status === 302) {
        return { created: true };
    }
    // Nếu đã tồn tại (400) → thử login
    res = await sendWithCsrf(client, 'post', '/auth/login', {
        identifier: username,
        password,
    });
    if (res.status === 302) {
        return { created: false };
    }
    return { created: false, error: res };
}

// Tạo chuỗi YouTube ID LUÔN đúng 11 ký tự hợp lệ khớp regex ^[a-zA-Z0-9_-]{11}$
// prefix là 1 ký tự hợp lệ (a-f) để phân biệt từng lần tạo, tránh trùng trong 1 lần chạy.
const YT_CHARS =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
function makeYoutubeId(prefix) {
    let id = String(prefix).charAt(0); // prefix phải là ký tự hợp lệ
    while (id.length < 11) {
        id += YT_CHARS[Math.floor(Math.random() * YT_CHARS.length)];
    }
    return id;
}

// ============================================================
// KẾT NỐI DB (để query courseId, đếm dữ liệu cũ, cascade)
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

    // ---------- PHẦN 1: LUỒNG UGC (user_owner) ----------
    console.log('\n===== PHẦN 1: LUỒNG UGC (user_owner) =====');

    // 1.1 Đăng ký user_owner
    const ownerUser = {
        name: 'Owner User',
        username: 'user_owner',
        email: 'user_owner@test.com',
        password: '12345678',
    };
    const regOwner = await ensureUser(owner.client, ownerUser);
    record('1.1 Đăng ký user_owner', 302, regOwner.error ? regOwner.error.status : 302, regOwner.error || {});
    createdData.push({ type: 'user', username: ownerUser.username });

    // 1.2 Tạo Course
    const courseVideoid = makeYoutubeId('a');
    const courseName = `E2E Course ${Date.now()}`;
    const storeCourse = await sendWithCsrf(owner.client, 'post', '/courses/store', {
        name: courseName,
        videoid: courseVideoid,
        description: 'E2E test course',
        level: 'Nâng cao',
    });
    record('1.2 Tạo Course', 302, storeCourse.status, storeCourse.data);

    // 1.3 Lấy courseId từ DB (vì store trả redirect, không trả JSON)
    let courseDoc = await Course.findOne({ videoid: courseVideoid });
    const courseId = courseDoc ? courseDoc._id.toString() : null;
    record('1.3 Lấy courseId từ DB', 'non-null', courseId ? 'non-null' : 'null', { courseId });
    createdData.push({ type: 'course', id: courseId, name: courseName });

    // Khai báo các ID phụ thuộc (để Phần 2, 3 dùng được dù Phần 1 có fail)
    let roadmapId = null;
    let module1Id = null;
    let module2Id = null;
    let video1Id = null;
    let video2Id = null;

    // GUARD: nếu courseId null → dừng Phần 1, không chạy các bước phụ thuộc
    if (!courseId) {
        console.log(
            '\n[GUARD] Không thể tiếp tục vì tạo Course thất bại ở bước 1.2 — bỏ qua các bước 1.4-1.15',
        );
        skip('1.4 Tạo Roadmap', 'courseId null (Course tạo thất bại ở 1.2)');
        skip('1.5 Lưu roadmapId', 'courseId null');
        skip('1.6 Gán Course vào Roadmap', 'courseId null');
        skip('1.7 Tạo Module 1', 'courseId null');
        skip('1.8 Tạo Module 2', 'courseId null');
        skip('1.9 Lưu module1Id + module2Id', 'courseId null');
        skip('1.10 Tạo Video 1', 'courseId null');
        skip('1.11 Tạo Video 2', 'courseId null');
        skip('1.12 Lưu video1Id + video2Id', 'courseId null');
        skip('1.13 Reorder Module 2 lên', 'courseId null');
        skip('1.14 Reorder Video 2 lên', 'courseId null');
        skip('1.15 Reorder ở biên (400)', 'courseId null');
    } else {
        // 1.4 Tạo Roadmap
        const roadmapName = `E2E Roadmap ${Date.now()}`;
        const storeRoadmap = await sendWithCsrf(owner.client, 'post', '/roadmaps', {
            name: roadmapName,
            description: 'E2E test roadmap',
            isPublic: true,
        });
        record('1.4 Tạo Roadmap', 201, storeRoadmap.status, storeRoadmap.data);
        roadmapId =
            storeRoadmap.data && storeRoadmap.data.roadmap
                ? storeRoadmap.data.roadmap._id
                : null;
        createdData.push({ type: 'roadmap', id: roadmapId, name: roadmapName });

        // 1.5 Lưu roadmapId (đã lấy ở 1.4)
        record('1.5 Lưu roadmapId', 'non-null', roadmapId ? 'non-null' : 'null', { roadmapId });

        // 1.6 Gán Course vào Roadmap (PUT /courses/:id với roadmapId)
        const assignRoadmap = await sendWithCsrf(owner.client, 'put', `/courses/${courseId}`, {
            roadmapId,
        });
        record('1.6 Gán Course vào Roadmap', 302, assignRoadmap.status, assignRoadmap.data);

        // 1.7 Tạo Module 1
        const storeModule1 = await sendWithCsrf(owner.client, 'post', `/courses/${courseId}/modules`, {
            name: 'Module 1',
        });
        record('1.7 Tạo Module 1', 201, storeModule1.status, storeModule1.data);
        module1Id =
            storeModule1.data && storeModule1.data.module
                ? storeModule1.data.module._id
                : null;
        createdData.push({ type: 'module', id: module1Id, name: 'Module 1' });

        // 1.8 Tạo Module 2
        const storeModule2 = await sendWithCsrf(owner.client, 'post', `/courses/${courseId}/modules`, {
            name: 'Module 2',
        });
        record('1.8 Tạo Module 2', 201, storeModule2.status, storeModule2.data);
        module2Id =
            storeModule2.data && storeModule2.data.module
                ? storeModule2.data.module._id
                : null;
        createdData.push({ type: 'module', id: module2Id, name: 'Module 2' });

        // 1.9 Lưu module1Id, module2Id
        record('1.9 Lưu module1Id + module2Id', 'non-null', module1Id && module2Id ? 'non-null' : 'null', {
            module1Id,
            module2Id,
        });

        // 1.10 Tạo Video 1 trong Module 1
        const video1YoutubeId = makeYoutubeId('b');
        const storeVideo1 = await sendWithCsrf(owner.client, 'post', `/modules/${module1Id}/videos`, {
            youtubeId: video1YoutubeId,
            title: 'Video 1',
            duration: '10:00',
        });
        record('1.10 Tạo Video 1', 201, storeVideo1.status, storeVideo1.data);
        video1Id =
            storeVideo1.data && storeVideo1.data.video
                ? storeVideo1.data.video._id
                : null;
        createdData.push({ type: 'video', id: video1Id, title: 'Video 1' });

        // 1.11 Tạo Video 2 trong Module 1
        const video2YoutubeId = makeYoutubeId('c');
        const storeVideo2 = await sendWithCsrf(owner.client, 'post', `/modules/${module1Id}/videos`, {
            youtubeId: video2YoutubeId,
            title: 'Video 2',
            duration: '12:00',
        });
        record('1.11 Tạo Video 2', 201, storeVideo2.status, storeVideo2.data);
        video2Id =
            storeVideo2.data && storeVideo2.data.video
                ? storeVideo2.data.video._id
                : null;
        createdData.push({ type: 'video', id: video2Id, title: 'Video 2' });

        // 1.12 Lưu video1Id, video2Id
        record('1.12 Lưu video1Id + video2Id', 'non-null', video1Id && video2Id ? 'non-null' : 'null', {
            video1Id,
            video2Id,
        });

        // 1.13 Reorder Module 2 lên trên (direction: up)
        const reorderModule = await sendWithCsrf(owner.client, 'patch', `/modules/${module2Id}/reorder`, {
            direction: 'up',
        });
        record('1.13 Reorder Module 2 lên', 200, reorderModule.status, reorderModule.data);

        // 1.14 Reorder Video 2 lên trên (direction: up)
        const reorderVideo = await sendWithCsrf(owner.client, 'patch', `/videos/${video2Id}/reorder`, {
            direction: 'up',
        });
        record('1.14 Reorder Video 2 lên', 200, reorderVideo.status, reorderVideo.data);

        // 1.15 Reorder ở biên (Module 1 đang ở cuối, direction: down → 400)
        const reorderBoundary = await sendWithCsrf(owner.client, 'patch', `/modules/${module1Id}/reorder`, {
            direction: 'down',
        });
        record('1.15 Reorder ở biên (400)', 400, reorderBoundary.status, reorderBoundary.data);
    }

    // ---------- PHẦN 2: PHÂN QUYỀN (user_other) ----------
    console.log('\n===== PHẦN 2: PHÂN QUYỀN (user_other) =====');

    // Đăng ký user_other
    const otherUser = {
        name: 'Other User',
        username: 'user_other',
        email: 'user_other@test.com',
        password: '12345678',
    };
    const regOther = await ensureUser(other.client, otherUser);
    record('2.0 Đăng ký user_other', 302, regOther.error ? regOther.error.status : 302, regOther.error || {});
    createdData.push({ type: 'user', username: otherUser.username });

    // 2.1 Sửa Course của user_owner
    if (!courseId) {
        skip('2.1 user_other sửa Course → 403', 'courseId null');
    } else {
        const p21 = await sendWithCsrf(other.client, 'put', `/courses/${courseId}`, { name: 'Hack' });
        record('2.1 user_other sửa Course → 403', 403, p21.status, p21.data);
    }

    // 2.2 Xóa mềm Course của user_owner
    if (!courseId) {
        skip('2.2 user_other xóa mềm Course → 403', 'courseId null');
    } else {
        const p22 = await sendWithCsrf(other.client, 'delete', `/courses/${courseId}`);
        record('2.2 user_other xóa mềm Course → 403', 403, p22.status, p22.data);
    }

    // 2.3 Xem form sửa Course
    if (!courseId) {
        skip('2.3 user_other xem form sửa Course → 403', 'courseId null');
    } else {
        const p23 = await other.client.get(`/courses/${courseId}/edit`);
        record('2.3 user_other xem form sửa Course → 403', 403, p23.status, p23.data);
    }

    // 2.4 Sửa Roadmap
    if (!roadmapId) {
        skip('2.4 user_other sửa Roadmap → 403', 'roadmapId null');
    } else {
        const p24 = await sendWithCsrf(other.client, 'put', `/roadmaps/${roadmapId}`, { name: 'Hack' });
        record('2.4 user_other sửa Roadmap → 403', 403, p24.status, p24.data);
    }

    // 2.5 Xóa Roadmap
    if (!roadmapId) {
        skip('2.5 user_other xóa Roadmap → 403', 'roadmapId null');
    } else {
        const p25 = await sendWithCsrf(other.client, 'delete', `/roadmaps/${roadmapId}`);
        record('2.5 user_other xóa Roadmap → 403', 403, p25.status, p25.data);
    }

    // 2.6 Sửa Module
    if (!module1Id) {
        skip('2.6 user_other sửa Module → 403', 'module1Id null');
    } else {
        const p26 = await sendWithCsrf(other.client, 'put', `/modules/${module1Id}`, { name: 'Hack' });
        record('2.6 user_other sửa Module → 403', 403, p26.status, p26.data);
    }

    // 2.7 Xóa Module
    if (!module1Id) {
        skip('2.7 user_other xóa Module → 403', 'module1Id null');
    } else {
        const p27 = await sendWithCsrf(other.client, 'delete', `/modules/${module1Id}`);
        record('2.7 user_other xóa Module → 403', 403, p27.status, p27.data);
    }

    // 2.8 Reorder Module
    if (!module1Id) {
        skip('2.8 user_other reorder Module → 403', 'module1Id null');
    } else {
        const p28 = await sendWithCsrf(other.client, 'patch', `/modules/${module1Id}/reorder`, { direction: 'up' });
        record('2.8 user_other reorder Module → 403', 403, p28.status, p28.data);
    }

    // 2.9 Sửa Video
    if (!video1Id) {
        skip('2.9 user_other sửa Video → 403', 'video1Id null');
    } else {
        const p29 = await sendWithCsrf(other.client, 'put', `/videos/${video1Id}`, { title: 'Hack' });
        record('2.9 user_other sửa Video → 403', 403, p29.status, p29.data);
    }

    // 2.10 Xóa Video
    if (!video1Id) {
        skip('2.10 user_other xóa Video → 403', 'video1Id null');
    } else {
        const p210 = await sendWithCsrf(other.client, 'delete', `/videos/${video1Id}`);
        record('2.10 user_other xóa Video → 403', 403, p210.status, p210.data);
    }

    // 2.11 Reorder Video
    if (!video1Id) {
        skip('2.11 user_other reorder Video → 403', 'video1Id null');
    } else {
        const p211 = await sendWithCsrf(other.client, 'patch', `/videos/${video1Id}/reorder`, { direction: 'up' });
        record('2.11 user_other reorder Video → 403', 403, p211.status, p211.data);
    }

    // 2.12 Tạo Module trong Course của user_owner
    if (!courseId) {
        skip('2.12 user_other tạo Module → 403', 'courseId null');
    } else {
        const p212 = await sendWithCsrf(other.client, 'post', `/courses/${courseId}/modules`, { name: 'Hack' });
        record('2.12 user_other tạo Module → 403', 403, p212.status, p212.data);
    }

    // 2.13 Tạo Video trong Module của user_owner
    if (!module1Id) {
        skip('2.13 user_other tạo Video → 403', 'module1Id null');
    } else {
        const p213 = await sendWithCsrf(other.client, 'post', `/modules/${module1Id}/videos`, {
            youtubeId: makeYoutubeId('d'),
            title: 'Hack',
        });
        record('2.13 user_other tạo Video → 403', 403, p213.status, p213.data);
    }

    // 2.14 Xác nhận DB không đổi (name của Course/Roadmap/Module/Video vẫn nguyên)
    if (!courseId || !module1Id || !video1Id) {
        skip('2.14 DB không đổi sau các request 403', 'courseId/module1Id/video1Id null');
    } else {
        const dbCourse = await Course.findById(courseId);
        const dbModule = await Module.findById(module1Id);
        const dbVideo = await Video.findById(video1Id);
        const dbUnchanged =
            dbCourse && dbCourse.name === courseName &&
            dbModule && dbModule.name === 'Module 1' &&
            dbVideo && dbVideo.title === 'Video 1';
        record('2.14 DB không đổi sau các request 403', true, dbUnchanged, {
            courseName: dbCourse && dbCourse.name,
            moduleName: dbModule && dbModule.name,
            videoTitle: dbVideo && dbVideo.title,
        });
    }

    // ---------- PHẦN 3: ADMIN ----------
    console.log('\n===== PHẦN 3: ADMIN =====');

    // Đăng nhập admin
    const loginAdmin = await sendWithCsrf(admin.client, 'post', '/auth/login', {
        identifier: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
    });
    record('3.0 Đăng nhập admin', 302, loginAdmin.status, loginAdmin.data);

    // 3.1 Xem form sửa Course của user_owner
    if (!courseId) {
        skip('3.1 admin xem form sửa Course → 200', 'courseId null');
    } else {
        const a31 = await admin.client.get(`/courses/${courseId}/edit`);
        record('3.1 admin xem form sửa Course → 200', 200, a31.status, a31.data);
    }

    // 3.2 Sửa Course (đổi description)
    if (!courseId) {
        skip('3.2 admin sửa Course → 302', 'courseId null');
    } else {
        const a32 = await sendWithCsrf(admin.client, 'put', `/courses/${courseId}`, {
            description: 'E2E edited by admin',
        });
        record('3.2 admin sửa Course → 302', 302, a32.status, a32.data);
    }

    // 3.3 Sửa Roadmap
    if (!roadmapId) {
        skip('3.3 admin sửa Roadmap → 200', 'roadmapId null');
    } else {
        const a33 = await sendWithCsrf(admin.client, 'put', `/roadmaps/${roadmapId}`, {
            description: 'E2E edited by admin',
        });
        record('3.3 admin sửa Roadmap → 200', 200, a33.status, a33.data);
    }

    // 3.4 Sửa Module
    if (!module1Id) {
        skip('3.4 admin sửa Module → 200', 'module1Id null');
    } else {
        const a34 = await sendWithCsrf(admin.client, 'put', `/modules/${module1Id}`, {
            name: 'Module 1 (admin)',
        });
        record('3.4 admin sửa Module → 200', 200, a34.status, a34.data);
    }

    // 3.5 Sửa Video
    if (!video1Id) {
        skip('3.5 admin sửa Video → 200', 'video1Id null');
    } else {
        const a35 = await sendWithCsrf(admin.client, 'put', `/videos/${video1Id}`, {
            title: 'Video 1 (admin)',
        });
        record('3.5 admin sửa Video → 200', 200, a35.status, a35.data);
    }

    // 3.6 Reorder Module
    if (!module1Id) {
        skip('3.6 admin reorder Module → 200', 'module1Id null');
    } else {
        const a36 = await sendWithCsrf(admin.client, 'patch', `/modules/${module1Id}/reorder`, {
            direction: 'up',
        });
        record('3.6 admin reorder Module → 200', 200, a36.status, a36.data);
    }

    // 3.7 Xóa mềm Course của user_owner
    if (!courseId) {
        skip('3.7 admin xóa mềm Course → 302', 'courseId null');
    } else {
        const a37 = await sendWithCsrf(admin.client, 'delete', `/courses/${courseId}`);
        record('3.7 admin xóa mềm Course → 302', 302, a37.status, a37.data);
    }

    // 3.8 Khôi phục Course
    if (!courseId) {
        skip('3.8 admin khôi phục Course → 302', 'courseId null');
    } else {
        const a38 = await sendWithCsrf(admin.client, 'patch', `/courses/${courseId}/restore`);
        record('3.8 admin khôi phục Course → 302', 302, a38.status, a38.data);
    }

    // 3.9 Xóa vĩnh viễn Course (force) — cascade xóa Module/Video
    if (!courseId) {
        skip('3.9 admin force-delete Course → 302', 'courseId null');
    } else {
        const a39 = await sendWithCsrf(admin.client, 'delete', `/courses/${courseId}/force`);
        record('3.9 admin force-delete Course → 302', 302, a39.status, a39.data);
    }

    // 3.10 Xác nhận cascade: Module/Video của course đã bị xóa cứng
    if (!courseId) {
        skip('3.10 Cascade xóa Module/Video sau force-delete (0)', 'courseId null');
    } else {
        const cascadeModules = await Module.countDocuments({ courseId });
        const cascadeVideos = await Video.countDocuments({
            moduleId: { $in: [module1Id, module2Id].filter(Boolean) },
        });
        record('3.10 Cascade xóa Module/Video sau force-delete (0)', 0, cascadeModules + cascadeVideos, {
            cascadeModules,
            cascadeVideos,
        });
    }

    // ---------- PHẦN 4: DỮ LIỆU CŨ (5 Course mồ côi) ----------
    console.log('\n===== PHẦN 4: DỮ LIỆU CŨ (Course mồ côi) =====');

    // 4.1 Đếm course mồ côi (createdBy null/undefined/thiếu)
    const orphanCount = await Course.collection.countDocuments({
        $or: [{ createdBy: null }, { createdBy: { $exists: false } }],
    });
    record('4.1 Đếm Course mồ côi (>= 1)', '>=1', orphanCount >= 1 ? '>=1' : String(orphanCount), {
        orphanCount,
    });

    // Lấy 1 course mồ côi để test
    const orphanDoc = await Course.collection.findOne({
        $or: [{ createdBy: null }, { createdBy: { $exists: false } }],
    });
    const orphanId = orphanDoc ? orphanDoc._id.toString() : null;
    const orphanSlug = orphanDoc ? orphanDoc.slug : null;
    record('4.1b Lấy 1 Course mồ côi', 'non-null', orphanId ? 'non-null' : 'null', { orphanId, orphanSlug });

    // 4.2 Khách xem Course mồ côi (GET /courses/:slug)
    if (!orphanSlug) {
        skip('4.2 Khách xem Course mồ côi → 200', 'orphanSlug null');
    } else {
        const p42 = await owner.client.get(`/courses/${orphanSlug}`);
        record('4.2 Khách xem Course mồ côi → 200', 200, p42.status, p42.data);
    }

    // 4.3 Khách xem danh sách (GET /)
    const p43 = await owner.client.get('/');
    record('4.3 Khách xem trang chủ → 200', 200, p43.status, p43.data);

    // 4.4 user_other sửa Course mồ côi → 403
    if (!orphanId) {
        skip('4.4 user_other sửa Course mồ côi → 403', 'orphanId null');
    } else {
        const p44 = await sendWithCsrf(other.client, 'put', `/courses/${orphanId}`, { name: 'Hack' });
        record('4.4 user_other sửa Course mồ côi → 403', 403, p44.status, p44.data);
    }

    // 4.5 user_other xóa mềm Course mồ côi → 403
    if (!orphanId) {
        skip('4.5 user_other xóa mềm Course mồ côi → 403', 'orphanId null');
    } else {
        const p45 = await sendWithCsrf(other.client, 'delete', `/courses/${orphanId}`);
        record('4.5 user_other xóa mềm Course mồ côi → 403', 403, p45.status, p45.data);
    }

    // 4.6 admin sửa Course mồ côi → 302
    if (!orphanId) {
        skip('4.6 admin sửa Course mồ côi → 302', 'orphanId null');
    } else {
        const p46 = await sendWithCsrf(admin.client, 'put', `/courses/${orphanId}`, {
            description: 'E2E edited orphan by admin',
        });
        record('4.6 admin sửa Course mồ côi → 302', 302, p46.status, p46.data);
    }

    // 4.7 admin xóa mềm Course mồ côi → 302
    if (!orphanId) {
        skip('4.7 admin xóa mềm Course mồ côi → 302', 'orphanId null');
    } else {
        const p47 = await sendWithCsrf(admin.client, 'delete', `/courses/${orphanId}`);
        record('4.7 admin xóa mềm Course mồ côi → 302', 302, p47.status, p47.data);
    }

    // 4.8 admin khôi phục Course mồ côi → 302
    if (!orphanId) {
        skip('4.8 admin khôi phục Course mồ côi → 302', 'orphanId null');
    } else {
        const p48 = await sendWithCsrf(admin.client, 'patch', `/courses/${orphanId}/restore`);
        record('4.8 admin khôi phục Course mồ côi → 302', 302, p48.status, p48.data);
    }

    // ---------- PHẦN 5: CASCADE XÓA (soft-delete Course KHÔNG cascade) ----------
    console.log('\n===== PHẦN 5: SOFT-DELETE COURSE KHÔNG CASCADE =====');

    // Tạo Course mới (course2) + Module + Video để test (vì course1 đã bị force-delete ở 3.9)
    const course2Videoid = makeYoutubeId('e');
    const course2Name = `E2E Cascade Course ${Date.now()}`;
    const storeCourse2 = await sendWithCsrf(owner.client, 'post', '/courses/store', {
        name: course2Name,
        videoid: course2Videoid,
        description: 'E2E cascade test',
    });
    record('5.0a Tạo Course mới (course2)', 302, storeCourse2.status, storeCourse2.data);
    const course2Doc = await Course.findOne({ videoid: course2Videoid });
    const course2Id = course2Doc ? course2Doc._id.toString() : null;
    createdData.push({ type: 'course', id: course2Id, name: course2Name });

    let c2ModuleId = null;
    let c2VideoId = null;

    // GUARD: nếu course2Id null → dừng Phần 5
    if (!course2Id) {
        console.log(
            '\n[GUARD] Không thể tiếp tục vì tạo Course (course2) thất bại ở bước 5.0a — bỏ qua các bước 5.0b-5.7',
        );
        skip('5.0b Tạo Module trong course2', 'course2Id null');
        skip('5.0c Tạo Video trong course2', 'course2Id null');
        skip('5.1 Đếm Module/Video trước (>=1)', 'course2Id null');
        skip('5.2 Soft-delete Course → 302', 'course2Id null');
        skip('5.3 Module không bị xóa (số lượng không đổi)', 'course2Id null');
        skip('5.4 Video không bị xóa (số lượng không đổi)', 'course2Id null');
        skip('5.5 GET Course đã soft-delete → 404', 'course2Id null');
        skip('5.6 Restore Course → 302', 'course2Id null');
        skip('5.7 GET Course đã restore → 200', 'course2Id null');
    } else {
        const storeC2Module = await sendWithCsrf(owner.client, 'post', `/courses/${course2Id}/modules`, {
            name: 'Cascade Module',
        });
        record('5.0b Tạo Module trong course2', 201, storeC2Module.status, storeC2Module.data);
        c2ModuleId =
            storeC2Module.data && storeC2Module.data.module
                ? storeC2Module.data.module._id
                : null;
        createdData.push({ type: 'module', id: c2ModuleId, name: 'Cascade Module' });

        // GUARD: nếu c2ModuleId null → skip các bước phụ thuộc Module
        if (!c2ModuleId) {
            skip('5.0c Tạo Video trong course2', 'c2ModuleId null');
            skip('5.1 Đếm Module/Video trước (>=1)', 'c2ModuleId null');
            skip('5.2 Soft-delete Course → 302', 'c2ModuleId null');
            skip('5.3 Module không bị xóa (số lượng không đổi)', 'c2ModuleId null');
            skip('5.4 Video không bị xóa (số lượng không đổi)', 'c2ModuleId null');
            skip('5.5 GET Course đã soft-delete → 404', 'c2ModuleId null');
            skip('5.6 Restore Course → 302', 'c2ModuleId null');
            skip('5.7 GET Course đã restore → 200', 'c2ModuleId null');
        } else {
            const storeC2Video = await sendWithCsrf(owner.client, 'post', `/modules/${c2ModuleId}/videos`, {
                youtubeId: makeYoutubeId('f'),
                title: 'Cascade Video',
            });
            record('5.0c Tạo Video trong course2', 201, storeC2Video.status, storeC2Video.data);
            c2VideoId =
                storeC2Video.data && storeC2Video.data.video
                    ? storeC2Video.data.video._id
                    : null;
            createdData.push({ type: 'video', id: c2VideoId, title: 'Cascade Video' });

            // 5.1 Đếm Module/Video của course2 (trước)
            const beforeModules = await Module.countDocuments({ courseId: course2Id });
            const beforeVideos = await Video.countDocuments({ moduleId: c2ModuleId });
            record('5.1 Đếm Module/Video trước (>=1)', '>=1', beforeModules >= 1 && beforeVideos >= 1 ? '>=1' : '0', {
                beforeModules,
                beforeVideos,
            });

            // 5.2 Soft-delete Course (user_owner — chủ sở hữu)
            const p52 = await sendWithCsrf(owner.client, 'delete', `/courses/${course2Id}`);
            record('5.2 Soft-delete Course → 302', 302, p52.status, p52.data);

            // 5.3 Xác nhận Module KHÔNG bị xóa
            const afterModules = await Module.countDocuments({ courseId: course2Id });
            record('5.3 Module không bị xóa (số lượng không đổi)', beforeModules, afterModules, { beforeModules, afterModules });

            // 5.4 Xác nhận Video KHÔNG bị xóa
            const afterVideos = await Video.countDocuments({ moduleId: c2ModuleId });
            record('5.4 Video không bị xóa (số lượng không đổi)', beforeVideos, afterVideos, { beforeVideos, afterVideos });

            // 5.5 GET /courses/:slug (course đã soft-delete) → 404
            const p55 = await owner.client.get(`/courses/${course2Doc.slug}`);
            record('5.5 GET Course đã soft-delete → 404', 404, p55.status, p55.data);

            // 5.6 Restore Course (admin)
            const p56 = await sendWithCsrf(admin.client, 'patch', `/courses/${course2Id}/restore`);
            record('5.6 Restore Course → 302', 302, p56.status, p56.data);

            // 5.7 GET /courses/:slug (đã restore) → 200
            const p57 = await owner.client.get(`/courses/${course2Doc.slug}`);
            record('5.7 GET Course đã restore → 200', 200, p57.status, p57.data);
        }
    }

    // ============================================================
    // TỔNG KẾT
    // ============================================================
    console.log('\n===== TỔNG KẾT =====');
    const total = results.length;
    const passCount = results.filter((r) => r.pass && !r.skipped).length;
    const skipCount = results.filter((r) => r.skipped).length;
    const failCount = results.filter((r) => !r.pass && !r.skipped).length;
    console.log(`Tổng số bước: ${total}`);
    console.log(`PASS: ${passCount}`);
    console.log(`SKIP: ${skipCount}`);
    console.log(`FAIL: ${failCount}`);
    if (failCount > 0) {
        console.log('\nDanh sách các bước FAIL:');
        results
            .filter((r) => !r.pass && !r.skipped)
            .forEach((r) => {
                console.log(`  - ${r.name} (status ${r.actual}, expected ${r.expected.join('/')})`);
            });
    }
    if (skipCount > 0) {
        console.log('\nDanh sách các bước SKIP (do ID phụ thuộc null):');
        results
            .filter((r) => r.skipped)
            .forEach((r) => {
                console.log(`  - ${r.name} (${r.data && r.data.reason})`);
            });
    }

    // ============================================================
    // DỌN DẸP
    // ============================================================
    console.log('\n===== DỌN DẸP (dữ liệu test đã tạo) =====');
    console.log('Các dữ liệu sau đã được tạo trong quá trình test — xóa tay nếu muốn dọn DB sạch:');
    createdData.forEach((d) => {
        console.log(`  - ${d.type}: ${d.id || d.username || d.name} (${d.name || d.title || d.username || ''})`);
    });
    console.log('\nLưu ý:');
    console.log('  - Course 1 (E2E Course) đã bị force-delete ở bước 3.9 (cascade xóa Module/Video).');
    console.log('  - Course mồ côi (Phần 4) đã được sửa description bởi admin (4.6) — nếu muốn giữ nguyên, cần restore lại description.');
    console.log('  - Course 2 (E2E Cascade Course) vẫn còn (đã restore ở 5.6) — xóa tay nếu muốn.');
    console.log('  - user_owner, user_other, roadmap, module, video còn lại — xóa tay nếu muốn.');

    await disconnectDb();
    process.exit(failCount > 0 ? 1 : 0);
})().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});