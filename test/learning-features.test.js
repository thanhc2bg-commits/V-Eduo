/**
 * Test thật cho bộ test mục 6.5 — 3 case lỗ hổng quan trọng nhất:
 *
 * 1. RACE CONDITION: 2 request đồng thời POST /api/videos/:id/complete
 *    → completedVideoIds CHỈ có 1 phần tử, chỉ 1 activity video_completed được ghi.
 *
 * 2. IDOR: user B sửa/xóa note của user A → phải trả 404 (không tiết lộ note tồn tại).
 *
 * 3. AUTHORIZATION: course private + user chưa enroll + không phải owner
 *    → POST /api/videos/:id/complete phải trả 403.
 *
 * Yêu cầu:
 *  - MongoDB local đang chạy (mongodb://localhost:27017/V-connect-dev)
 *  - Server đang chạy tại http://localhost:3000 (npm start)
 *  - JWT_SECRET trong .env (server load qua dotenv)
 *
 * ✅ ĐÃ CẬP NHẬT (Phase 2): Đã xóa `videoid` khỏi tất cả Course.create mock data.
 *   Course không còn lưu youtubeId — video quản lý qua Module/Video.
 *
 * Chạy: node test/learning-features.test.js
 *
 * LƯU Ý: Script sẽ XÓA các dữ liệu test tạo ra sau khi chạy xong.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Course = require('../src/app/models/Course');
const Module = require('../src/app/models/Module');
const Video = require('../src/app/models/Video');
const User = require('../src/app/models/User');
const Enrollment = require('../src/app/models/Enrollment');
const Note = require('../src/app/models/Note');
const Activity = require('../src/app/models/Activity');

const BASE_URL = 'http://localhost:3000';
const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';

// ------ Check an toàn: chỉ cho phép chạy trên DB dev/test ------
if (!/test|dev/i.test(MONGODB_URI)) {
    throw new Error(
        `Không chạy test script trên DB không phải dev/test! (URI: ${MONGODB_URI})`,
    );
}

let csrfToken = '';
let csrfCookie = '';

// Lấy CSRF token + cookie _csrf từ trang login (server render token vào form).
async function fetchCsrf() {
    const res = await fetch(BASE_URL + '/auth/login', { redirect: 'manual' });
    const body = await res.text();
    const m = body.match(/name="_csrf" value="([^"]+)"/);
    let setCookie = '';
    if (typeof res.headers.getSetCookie === 'function') {
        setCookie = res.headers.getSetCookie().join('; ');
    } else {
        setCookie = res.headers.get('set-cookie') || '';
    }
    const mCsrf = setCookie.match(/_csrf=([^;]+)/);
    if (!m || !mCsrf) {
        throw new Error('Không lấy được CSRF token/cookie');
    }
    csrfToken = m[1];
    csrfCookie = `_csrf=${mCsrf[1]}`;
}

// Đăng ký user mới qua HTTP và trả về cookie (accessToken + refreshToken + csrf)
async function registerAndGetCookie(name, username, email, password) {
    const res = await fetch(BASE_URL + '/auth/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-csrf-token': csrfToken,
            Cookie: csrfCookie,
        },
        body: new URLSearchParams({
            name,
            username,
            email,
            password,
        }).toString(),
        redirect: 'manual',
    });

    let setCookie = '';
    if (typeof res.headers.getSetCookie === 'function') {
        setCookie = res.headers.getSetCookie().join('; ');
    } else {
        setCookie = res.headers.get('set-cookie') || '';
    }
    const mAccess = setCookie.match(/accessToken=([^;]+)/);
    const mRefresh = setCookie.match(/refreshToken=([^;]+)/);
    if (!mAccess || !mRefresh) {
        // Đã tồn tại → thử login
        return loginAndGetCookie(username, password);
    }
    return `accessToken=${mAccess[1]}; refreshToken=${mRefresh[1]}; ${csrfCookie}`;
}

// Login và trả về cookie
async function loginAndGetCookie(identifier, password) {
    const res = await fetch(BASE_URL + '/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-csrf-token': csrfToken,
            Cookie: csrfCookie,
        },
        body: new URLSearchParams({
            identifier,
            password,
        }).toString(),
        redirect: 'manual',
    });

    let setCookie = '';
    if (typeof res.headers.getSetCookie === 'function') {
        setCookie = res.headers.getSetCookie().join('; ');
    } else {
        setCookie = res.headers.get('set-cookie') || '';
    }
    const mAccess = setCookie.match(/accessToken=([^;]+)/);
    const mRefresh = setCookie.match(/refreshToken=([^;]+)/);
    if (!mAccess || !mRefresh) {
        throw new Error(`Login thất bại cho ${identifier}`);
    }
    return `accessToken=${mAccess[1]}; refreshToken=${mRefresh[1]}; ${csrfCookie}`;
}

// Helper gọi API
async function api(cookie, method, path, body) {
    const headers = {
        Cookie: cookie,
        'x-csrf-token': csrfToken,
    };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(BASE_URL + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual',
    });
    return res;
}

// Bộ đếm kết quả
let passed = 0;
let failed = 0;
const failures = [];

function report(name, pass, detail) {
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
    if (pass) passed++;
    else {
        failed++;
        failures.push({ name, detail });
    }
}

async function main() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Lấy CSRF token trước
    await fetchCsrf();
    console.log('[Setup] CSRF token OK\n');

    // Tạo 2 user test (dọn sạch nếu có)
    const ts = Date.now();
    const userA = {
        name: 'User A',
        username: `usera_${ts}`,
        email: `usera_${ts}@test.com`,
        password: 'Password@123',
    };
    const userB = {
        name: 'User B',
        username: `userb_${ts}`,
        email: `userb_${ts}@test.com`,
        password: 'Password@123',
    };

    // Cleanup dữ liệu cũ từ lần chạy trước (nếu có)
    const existingA = await User.findOne({ username: userA.username });
    const existingB = await User.findOne({ username: userB.username });
    if (existingA) await User.deleteOne({ _id: existingA._id });
    if (existingB) await User.deleteOne({ _id: existingB._id });

    const cookieA = await registerAndGetCookie(
        userA.name,
        userA.username,
        userA.email,
        userA.password,
    );
    console.log('[Setup] User A đăng ký OK');

    const cookieB = await registerAndGetCookie(
        userB.name,
        userB.username,
        userB.email,
        userB.password,
    );
    console.log('[Setup] User B đăng ký OK\n');

    // Lưu id user
    const dbA = await User.findOne({ username: userA.username }).lean();
    const dbB = await User.findOne({ username: userB.username }).lean();
    const userAId = dbA._id;
    const userBId = dbB._id;

    // Tạo 1 course + 1 module + 1 video (qua DB trực tiếp để có data ổn định)
    const course = await Course.create({
        name: `Test Course ${ts}`,
        description: 'Test course cho learning features',
        createdBy: userAId,
        isPublic: true,
    });
    const module = await Module.create({
        name: 'Module 1',
        courseId: course._id,
        order: 0,
    });
    const video = await Video.create({
        youtubeId: 'testvideo12345',
        moduleId: module._id,
        title: 'Video Test',
        order: 0,
    });
    console.log('[Setup] Course + Module + Video tạo OK');
    console.log(`[Setup] courseId=${course._id}, videoId=${video._id}\n`);

    // Enroll user A vào course (qua API để kiểm tra luôn)
    const enrollRes = await api(cookieA, 'POST', `/api/courses/${course._id}/enroll`);
    console.log(`[Setup] User A enroll: HTTP ${enrollRes.status}\n`);

    // ======================================================================
    // CASE 1: RACE CONDITION — 2 request đồng thời complete cùng 1 video
    // ======================================================================
    console.log('=== CASE 1: RACE CONDITION — 2 request đồng thời ===');
    // Bắn 2 request THẬT đồng thời (Promise.all) cho cùng 1 video chưa hoàn thành
    const results = await Promise.all([
        api(cookieA, 'POST', `/api/videos/${video._id}/complete`),
        api(cookieA, 'POST', `/api/videos/${video._id}/complete`),
    ]);

    // Lấy lại enrollment sau race
    const enrollAfterRace = await Enrollment.findOne({
        userId: userAId,
        courseId: course._id,
    }).lean();

    // Đếm activity video_completed cho video này
    const activityCount = await Activity.countDocuments({
        userId: userAId,
        type: 'video_completed',
        videoId: video._id,
    });

    const racePass =
        enrollAfterRace.completedVideoIds.length === 1 &&
        activityCount === 1;
    report(
        'CASE 1: 2 request đồng thời complete → completedVideoIds chỉ 1 phần tử + 1 activity',
        racePass,
        `completedVideoIds.length=${enrollAfterRace.completedVideoIds.length} (kỳ vọng 1), activityCount=${activityCount} (kỳ vọng 1), HTTP=[${results[0].status},${results[1].status}]`,
    );
    console.log('');

    // ======================================================================
    // CASE 2: IDOR — user B sửa/xóa note user A
    // ======================================================================
    console.log('=== CASE 2: IDOR — user B sửa/xóa note user A ===');

    // User A tạo note
    const noteRes = await api(cookieA, 'POST', `/api/videos/${video._id}/notes`, {
        content: 'Note riêng của user A',
    });
    // Chú ý: content chúng tôi SO SÁNH phải khớp chính xác với content tạo note
    const ORIGINAL_NOTE_CONTENT = 'Note riêng của user A';
    const noteData = await noteRes.json();
    const noteId = noteData.note._id;
    console.log(`[Setup] user A tạo note: HTTP ${noteRes.status}, noteId=${noteId}`);

    // User B thử SỬA note user A
    const updateRes = await api(cookieB, 'PUT', `/api/notes/${noteId}`, {
        content: 'Bị hack bởi user B',
    });
    console.log(`[Test] user B sửa note user A: HTTP ${updateRes.status}`);

    // Kiểm tra DB: nội dung note không đổi
    const noteAfterUpdate = await Note.findById(noteId).lean();
    const idorUpdatePass =
        updateRes.status === 404 &&
        noteAfterUpdate.content === ORIGINAL_NOTE_CONTENT;
    report(
        'CASE 2a/User B sửa note user A → 404 + nội dung không đổi',
        idorUpdatePass,
        `HTTP=${updateRes.status} (kỳ vọng 404), content DB="${noteAfterUpdate.content}" (kỳ vọng "${ORIGINAL_NOTE_CONTENT}")`,
    );

    // User B thử XÓA note user A
    const deleteRes = await api(cookieB, 'DELETE', `/api/notes/${noteId}`);
    console.log(`[Test] user B xóa note user A: HTTP ${deleteRes.status}`);

    const noteAfterDelete = await Note.findById(noteId).lean();
    const idorDeletePass = deleteRes.status === 404 && noteAfterDelete !== null;
    report(
        'CASE 2b/User B xóa note user A → HTTP 404 + note vẫn còn trong DB',
        idorDeletePass,
        `HTTP=${deleteRes.status} (kỳ vọng 404), note còn tồn tại=${!!noteAfterDelete} (kỳ vọng true)`,
    );
    console.log();

    // ======================================================================
    // CASE 3: COURSE PRIVATE + user A chưa enroll + course thuộc user B
    // ======================================================================
    console.log('=== CASE 3: course private + user khác không phải owner ===');

    // Tạo course private thuộc user A (user A là owner)
    const privateCourse = await Course.create({
        name: `Private Course ${ts}`,
        description: 'Private course',
        createdBy: userAId,
        isPublic: false,
    });
    const privateModule = await Module.create({
        name: 'Module Private',
        courseId: privateCourse._id,
        order: 0,
    });
    const privateVideo = await Video.create({
        youtubeId: 'privatevideo123',
        moduleId: privateModule._id,
        title: 'Video Private',
        order: 0,
    });

    // User B (người lạ) KHÔNG enroll, KHÔNG phải owner → complete trả 403
    const privateCompleteRes = await api(
        cookieB,
        'POST',
        `/api/videos/${privateVideo._id}/complete`,
    );
    console.log(`[Test] user B complete video của course private: HTTP ${privateCompleteRes.status}`);

    // User B (người lạ) TRY ENROLL vào course private
    const privateEnrollRes = await api(
        cookieB,
        'POST',
        `/api/courses/${privateCourse._id}/enroll`,
    );
    console.log(`[Test] user B enroll course private (khởi phải owner): HTTP ${privateEnrollRes.status}`);

    const authzPass =
        privateCompleteRes.status === 403 && privateEnrollRes.status === 403;
    report(
        'CASE 3/User B chưa enroll + không owner course private → complete=403 + enroll=403',
        authzPass,
        `complete HTTP=${privateCompleteRes.status} (kỳ vọng 403), enroll HTTP=${privateEnrollRes.status} (kỳ vọng 403)`,
    );
    console.log();

    // ======================================================================
    // TỔNG KẾT
    // ======================================================================
    console.log('========================================');
    console.log(`KẾT QUẢ: ${passed} PASS / ${failed} FAIL`);
    if (failures.length) {
        console.log('\nChi tiết các case FAIL:');
        failures.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
    }

    // Cleanup dữ liệu test
    await User.deleteOne({ _id: userAId });
    await User.deleteOne({ _id: userBId });
    await Course.deleteOne({ _id: course._id });
    await Module.deleteOne({ _id: module._id });
    await Video.deleteOne({ _id: video._id });
    await Course.deleteOne({ _id: privateCourse._id });
    await Module.deleteOne({ _id: privateModule._id });
    await Video.deleteOne({ _id: privateVideo._id });
    await Enrollment.deleteMany({ userId: { $in: [userAId, userBId] } });
    await Note.deleteMany({ userId: { $in: [userAId, userBId] } });
    await Activity.deleteMany({ userId: { $in: [userAId, userBId] } });
    console.log('\n[Cleanup] Đã xóa dữ liệu test');

    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test crashed:', err);
    process.exit(1);
});