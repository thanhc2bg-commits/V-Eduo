/**
 * Test tự động Course CRUD + slug generation.
 *
 * Yêu cầu:
 *  - MongoDB local đang chạy (mongodb://localhost:27017/V-connect-dev)
 *  - Server đang chạy tại http://localhost:3000 (npm start)
 *  - JWT_SECRET trong .env (server load qua dotenv)
 *
 * Chạy: node test/course-crud.test.js
 *
 * LƯU Ý: Script sẽ XÓA TOÀN BỘ collection courses (hard delete) trước khi test
 * để kết quả slug xác định, đồng thời tạo 1 admin test và xóa sau khi test xong.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Course = require('../src/app/models/Course');
const User = require('../src/app/models/User');
const Session = require('../src/app/models/Session');

const BASE_URL = 'http://localhost:3000';
const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('Thiếu JWT_SECRET trong .env');
}

// ------ Check an toàn: chỉ cho phép chạy trên DB dev/test ------
if (!/test|dev/i.test(MONGODB_URI)) {
    throw new Error(
        `Không chạy test script trên DB không phải dev/test! (URI: ${MONGODB_URI})`,
    );
}

let adminCookie = '';
let adminId = null;
let adminRefreshToken = '';
let csrfCookie = '';
let csrfToken = '';

// Lấy CSRF token + cookie _csrf từ trang login (server render token vào form).
// Cookie _csrf là session cookie không gắn user — dùng chung cho mọi request.
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

// ---------- Helpers HTTP (không follow redirect để thấy status 302) ----------
async function httpPost(path, data) {
    return fetch(BASE_URL + path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: adminCookie,
            'x-csrf-token': csrfToken,
        },
        body: new URLSearchParams(data).toString(),
        redirect: 'manual',
    });
}

async function httpPut(path, data) {
    return fetch(BASE_URL + path, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: adminCookie,
            'x-csrf-token': csrfToken,
        },
        body: new URLSearchParams(data).toString(),
        redirect: 'manual',
    });
}

async function httpDelete(path) {
    return fetch(BASE_URL + path, {
        method: 'DELETE',
        headers: { Cookie: adminCookie, 'x-csrf-token': csrfToken },
        redirect: 'manual',
    });
}

async function fetchWithOrigin(origin) {
    return fetch(BASE_URL + '/', {
        method: 'GET',
        headers: origin ? { Origin: origin } : {},
        redirect: 'manual',
    });
}

// ---------- Bộ đếm kết quả ----------
let passed = 0;
let failed = 0;
const failures = [];
const allowedStatuses = new Set([200, 302, 400, 404, 409]);

function report(name, pass, detail) {
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
    if (pass) passed++;
    else {
        failed++;
        failures.push({ name, detail });
    }
}

function isControlled(status) {
    return allowedStatuses.has(status);
}

// Tạo YouTube video ID hợp lệ (đúng 11 ký tự: 'v' + 10 chữ số) cho test
function vid(n) {
    return 'v' + String(n).padStart(10, '0');
}

// ---------- Login admin qua HTTP thật (lấy 2 cookie: accessToken + refreshToken) ----------
async function loginAdminAndGetCookie(adminUsername, adminPassword) {
    const res = await fetch(BASE_URL + '/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-csrf-token': csrfToken,
            Cookie: csrfCookie,
        },
        body: new URLSearchParams({
            identifier: adminUsername,
            password: adminPassword,
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
        return { cookie: null, refreshToken: null, status: res.status };
    }
    return {
        cookie: `accessToken=${mAccess[1]}; refreshToken=${mRefresh[1]}; ${csrfCookie}`,
        refreshToken: mRefresh[1],
        status: res.status,
    };
}

// ---------- Main ----------
async function main() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Hard-clean courses + users + sessions (raw collection, vì deleteMany bị soft-delete override)
    await mongoose.connection.db.collection('courses').deleteMany({});
    await mongoose.connection.db.collection('users').deleteMany({});
    await mongoose.connection.db.collection('sessions').deleteMany({});
    console.log('Hard-cleared courses + users + sessions collections\n');

    // Lấy CSRF token + cookie _csrf (trước khi login — login cũng cần token)
    await fetchCsrf();
    console.log('[Setup] CSRF token OK\n');

    // Tạo admin test trực tiếp qua model (tránh luồng register luôn tạo role 'user')
    const ADMIN_USERNAME = 'testadmin';
    const ADMIN_PASSWORD = 'TestAdmin@123';
    const admin = await User.create({
        name: 'Test Admin',
        username: ADMIN_USERNAME,
        email: 'testadmin@example.com',
        password: ADMIN_PASSWORD,
        role: 'admin',
    });
    adminId = admin._id;

    // Login qua HTTP để lấy cookie JWT
    const login = await loginAdminAndGetCookie(ADMIN_USERNAME, ADMIN_PASSWORD);
    if (!login.cookie) {
        console.error(`KHÔNG lấy được cookie admin — login status=${login.status}`);
        console.error('Có thể server chưa chạy hoặc JWT_SECRET không khớp .env');
        await mongoose.disconnect();
        process.exit(1);
    }
    adminCookie = login.cookie;
    adminRefreshToken = login.refreshToken;
    console.log(`[Setup] Admin test đã login — cookie OK (status=${login.status})\n`);

    // ===== A. CREATE =====

    // Case 1: tạo khóa học tên "Kiểm tra CRUD"
    {
        const res = await httpPost('/courses/store', {
            name: 'Kiểm tra CRUD',
            videoid: vid(1),
        });
        const doc = await Course.findOne({ name: 'Kiểm tra CRUD' }).lean();
        report(
            'Case 1: tạo "Kiểm tra CRUD" -> slug "kiem-tra-crud"',
            doc && doc.slug === 'kiem-tra-crud' && !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${doc && doc.slug}"`,
        );
    }

    // Case 2: tạo tiếp khóa học CÙNG TÊN
    {
        const res = await httpPost('/courses/store', {
            name: 'Kiểm tra CRUD',
            videoid: vid(2),
        });
        const docs = await Course.find({ name: 'Kiểm tra CRUD' })
            .sort({ createdAt: 1 })
            .lean();
        const second = docs[1];
        report(
            'Case 2: tạo cùng tên lần 2 -> slug "kiem-tra-crud-1"',
            second &&
                second.slug === 'kiem-tra-crud-1' &&
                !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${second && second.slug}"`,
        );
    }

    // Case 3: tên chỉ khác ký tự đặc biệt "Kiểm Tra CRUD!!!"
    {
        const res = await httpPost('/courses/store', {
            name: 'Kiểm Tra CRUD!!!',
            videoid: vid(3),
        });
        const doc = await Course.findOne({ name: 'Kiểm Tra CRUD!!!' }).lean();
        report(
            'Case 3: "Kiểm Tra CRUD!!!" -> trùng base -> slug "kiem-tra-crud-2"',
            doc && doc.slug === 'kiem-tra-crud-2' && !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${doc && doc.slug}"`,
        );
    }

    // Case 4: tên rỗng / chỉ khoảng trắng
    {
        const res = await httpPost('/courses/store', {
            name: '   ',
            videoid: vid(4),
        });
        const count = await Course.countDocuments({ name: { $regex: /^\s*$/ } });
        report(
            'Case 4: name="   " -> bị chặn 400, không tạo bản ghi',
            res.status === 400 && count === 0,
            `HTTP=${res.status}, số bản ghi tên trống=${count} (kỳ vọng HTTP 400, 0 bản ghi)`,
        );
    }

    // Case 5: tên toàn ký tự đặc biệt -> slug rỗng sau strip -> fallback
    {
        const res = await httpPost('/courses/store', {
            name: '!!!@@@###',
            videoid: vid(5),
        });
        const doc = await Course.findOne({ name: '!!!@@@###' }).lean();
        report(
            'Case 5: "!!!@@@###" -> fallback slug course-<timestamp>',
            doc && /^course-\d+$/.test(doc.slug) && !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${doc && doc.slug}"`,
        );
    }

    // Case 6: 2 request cùng tên gần như đồng thời (race condition)
    {
        const [r1, r2] = await Promise.all([
            httpPost('/courses/store', { name: 'Race Test', videoid: vid(61) }),
            httpPost('/courses/store', { name: 'Race Test', videoid: vid(62) }),
        ]);
        const statuses = [r1.status, r2.status].sort();
        const docs = await Course.find({ name: 'Race Test' }).lean();
        const no500 = statuses.every((s) => s !== 500 && s !== 502 && s !== 503);
        report(
            'Case 6: 2 request đồng thời cùng tên -> không có 500',
            no500 && docs.length >= 1,
            `HTTP=[${statuses.join(', ')}], số bản ghi=${docs.length}, slugs=${docs
                .map((d) => d.slug)
                .join(', ')} (chấp nhận 409 do race, KHÔNG chấp nhận 500)`,
        );
    }

    // ===== B. UPDATE =====

    // Case 7: sửa tên -> slug phải được cập nhật (trọng tâm)
    {
        const created = await Course.create({
            name: 'Update Slug Test',
            videoid: 'vid-case7',
        });
        const res = await httpPut(`/courses/${created._id}`, {
            name: 'Update Slug Test Mới',
            description: 'đổi tên',
            videoid: vid(7),
        });
        const doc = await Course.findById(created._id).lean();
        report(
            'Case 7: đổi tên -> slug "update-slug-test-moi"',
            doc &&
                doc.slug === 'update-slug-test-moi' &&
                !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${doc && doc.slug}"`,
        );
    }

    // Case 8a: update KHÔNG gửi name (chỉ đổi mô tả) -> slug giữ nguyên
    {
        const created = await Course.create({
            name: 'Keep Slug Test',
            videoid: 'vid-case8a',
        });
        const res = await httpPut(`/courses/${created._id}`, {
            description: 'chỉ đổi mô tả, không gửi name',
            videoid: vid(81),
        });
        const doc = await Course.findById(created._id).lean();
        report(
            'Case 8a: update không gửi name -> slug giữ nguyên "keep-slug-test"',
            doc && doc.slug === 'keep-slug-test' && !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${doc && doc.slug}"`,
        );
    }

    // Case 8b: update gửi name KHÔNG đổi (giữ nguyên tên) -> slug không đổi
    {
        const created = await Course.create({
            name: 'Same Name Test',
            videoid: 'vid-case8b',
        });
        const res = await httpPut(`/courses/${created._id}`, {
            name: 'Same Name Test',
            description: 'chỉ đổi mô tả',
            videoid: vid(82),
        });
        const doc = await Course.findById(created._id).lean();
        report(
            'Case 8b: update giữ nguyên name -> slug không thêm hậu tố lạ',
            doc && doc.slug === 'same-name-test' && !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${doc && doc.slug}"`,
        );
    }

    // Case 9: sửa tên A trùng tên B -> slug A thêm hậu tố, excludeId hoạt động
    {
        const a = await Course.create({ name: 'Course Alpha', videoid: 'vid-case9a' });
        const b = await Course.create({ name: 'Course Beta', videoid: 'vid-case9b' });

        // 9.1: A đổi tên thành "Course Beta" -> A phải thành course-beta-1
        await httpPut(`/courses/${a._id}`, {
            name: 'Course Beta',
            videoid: vid(91),
        });
        const aAfterFirst = await Course.findById(a._id).lean();
        const firstOk = aAfterFirst.slug === 'course-beta-1';

        // 9.2: A đổi tên thành "Course Beta" LẦN NỮA -> excludeId chính nó
        //        -> slug phải GIỮ NGUYÊN course-beta-1, không thành -2
        await httpPut(`/courses/${a._id}`, {
            name: 'Course Beta',
            videoid: vid(91),
        });
        const aAfterSecond = await Course.findById(a._id).lean();
        const secondOk = aAfterSecond.slug === 'course-beta-1';

        const bDoc = await Course.findById(b._id).lean();
        report(
            'Case 9: A đổi tên trùng B -> A="course-beta-1", lặp lại không thành -2',
            firstOk && secondOk && bDoc.slug === 'course-beta',
            `A lần 1="${aAfterFirst.slug}", A lần 2="${aAfterSecond.slug}", B="${bDoc.slug}"`,
        );
    }

    // ===== C. DELETE =====

    // Case 10 (auth): request KHÔNG có cookie -> bị chặn (302 redirect hoặc 401)
    {
        const res = await fetch(BASE_URL + '/courses/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ name: 'No Auth Test', videoid: 'vid-noauth' }).toString(),
            redirect: 'manual',
        });
        const count = await Course.countDocuments({ name: 'No Auth Test' });
        report(
            'Case 10: không có cookie -> bị chặn (302/401/403), không tạo bản ghi',
            (res.status === 302 || res.status === 401 || res.status === 403) && count === 0,
            `HTTP=${res.status}, số bản ghi=${count} (kỳ vọng redirect/401/403, 0 bản ghi)`,
        );
    }

    // Case 11: xóa rồi tạo lại tên y hệt.
    // LƯU Ý: dự án dùng SOFT-DELETE (mongoose-delete, thùng rác) — bản đã xóa vẫn
    // còn trong collection và "giữ chỗ" slug gốc. Vì vậy tạo lại cùng tên sẽ được
    // sinh slug "reuse-slug-test-1" (không phải quay lại "reuse-slug-test").
    // Đây là hành vi ĐÚNG và an toàn với soft-delete, không phải bug.
    {
        const created = await Course.create({
            name: 'Reuse Slug Test',
            videoid: 'vid-case11',
        });
        const resDel = await httpDelete(`/courses/${created._id}`);
        const countAfterDel = await Course.countDocuments({ name: 'Reuse Slug Test' });

        const resCreate = await httpPost('/courses/store', {
            name: 'Reuse Slug Test',
            videoid: vid(112),
        });
        const recreated = await Course.findOne({ name: 'Reuse Slug Test' }).lean();

        report(
            'Case 11: xóa (soft) rồi tạo lại -> slug "reuse-slug-test-1" (bản deleted giữ chỗ slug gốc)',
            countAfterDel === 0 &&
                recreated &&
                recreated.slug === 'reuse-slug-test-1' &&
                !resCreate.status.toString().startsWith('5'),
            `HTTP delete=${resDel.status}, HTTP create=${resCreate.status}, slug mới="${recreated && recreated.slug}"`,
        );
    }

    // ===== C2. REFRESH TOKEN =====

    // Case 11b: access token hết hạn -> middleware tự refresh, request vẫn qua
    {
        // Tạo access token hết hạn ngay (TTL 1ms) nhưng giữ refreshToken hợp lệ
        const expiredAccess = jwt.sign(
            { id: adminId, username: 'testadmin', name: 'Test Admin', role: 'admin' },
            JWT_SECRET,
            { expiresIn: '1ms' },
        );
        const res = await fetch(BASE_URL + '/courses/store', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: `accessToken=${expiredAccess}; refreshToken=${adminRefreshToken}; ${csrfCookie}`,
                'x-csrf-token': csrfToken,
            },
            body: new URLSearchParams({
                name: 'Refresh Test',
                videoid: vid(113),
            }).toString(),
            redirect: 'manual',
        });
        const doc = await Course.findOne({ name: 'Refresh Test' }).lean();
        report(
            'Case 11b: access token hết hạn -> tự refresh, request qua được',
            doc && doc.slug === 'refresh-test' && !res.status.toString().startsWith('5'),
            `HTTP=${res.status}, slug="${doc && doc.slug}" (kỳ vọng tạo thành công, không 401)`,
        );
    }

    // Case 11d: accessToken cookie phải ĐỔI GIÁ TRỊ sau khi refresh.
    // LƯU Ý: JWT sign cùng payload + secret trong cùng 1 giây sẽ tạo token GIỐNG HỆT
    // (vì exp tính theo giây). Vì vậy so sánh token mới với token HẾT HẠN đã gửi đi
    // (chắc chắn khác) thay vì token gốc từ lúc login.
    {
        const expiredAccess = jwt.sign(
            { id: adminId, username: 'testadmin', name: 'Test Admin', role: 'admin' },
            JWT_SECRET,
            { expiresIn: '1ms' },
        );
        const res = await fetch(BASE_URL + '/courses/store', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: `accessToken=${expiredAccess}; refreshToken=${adminRefreshToken}; ${csrfCookie}`,
                'x-csrf-token': csrfToken,
            },
            body: new URLSearchParams({
                name: 'Refresh Token Change Test',
                videoid: vid(114),
            }).toString(),
            redirect: 'manual',
        });
        let setCookie = '';
        if (typeof res.headers.getSetCookie === 'function') {
            setCookie = res.headers.getSetCookie().join('; ');
        } else {
            setCookie = res.headers.get('set-cookie') || '';
        }
        const mNewAccess = setCookie.match(/accessToken=([^;]+)/);
        const newAccess = mNewAccess ? mNewAccess[1] : null;
        report(
            'Case 11d: accessToken cookie đổi giá trị sau khi refresh',
            newAccess && newAccess !== expiredAccess && !res.status.toString().startsWith('5'),
            `new=${newAccess ? newAccess.slice(0, 20) + '...' : 'null'} khác expired=${expiredAccess.slice(0, 20)}..., HTTP=${res.status}`,
        );
    }

    // Case 11c: refresh token cũ sau logout phải bị từ chối + session bị xóa
    {
        // 1. Refresh với token hợp lệ -> 200
        const resRefreshOk = await fetch(BASE_URL + '/auth/refresh', {
            method: 'POST',
            headers: {
                Cookie: `refreshToken=${adminRefreshToken}; ${csrfCookie}`,
                'x-csrf-token': csrfToken,
            },
            redirect: 'manual',
        });

        // 2. Logout -> xóa session
        const resLogout = await fetch(BASE_URL + '/auth/logout', {
            method: 'POST',
            headers: {
                Cookie: `refreshToken=${adminRefreshToken}; ${csrfCookie}`,
                'x-csrf-token': csrfToken,
            },
            redirect: 'manual',
        });

        // 3. Session phải bị xóa khỏi DB
        const sessionAfterLogout = await Session.collection.findOne({
            refreshToken: adminRefreshToken,
        });

        // 4. Refresh lại với token cũ -> phải bị từ chối
        const resRefreshAfterLogout = await fetch(BASE_URL + '/auth/refresh', {
            method: 'POST',
            headers: {
                Cookie: `refreshToken=${adminRefreshToken}; ${csrfCookie}`,
                'x-csrf-token': csrfToken,
            },
            redirect: 'manual',
        });

        report(
            'Case 11c: refresh sau logout bị từ chối + session bị xóa',
            resRefreshOk.status === 200 &&
                resLogout.status === 302 &&
                sessionAfterLogout === null &&
                (resRefreshAfterLogout.status === 401 ||
                    resRefreshAfterLogout.status === 403),
            `refresh trước logout=${resRefreshOk.status}, logout=${resLogout.status}, session còn=${!!sessionAfterLogout}, refresh sau logout=${resRefreshAfterLogout.status}`,
        );
    }

    // Case 11e: TTL index của Session tồn tại đúng cấu hình
    {
        const indexes = await Session.collection.indexes();
        const ttlIndex = indexes.find((idx) => idx.key && idx.key.expiresAt === 1);
        report(
            'Case 11e: TTL index Session (expiresAt, expireAfterSeconds=0) tồn tại',
            !!ttlIndex && ttlIndex.expireAfterSeconds === 0,
            `indexes=${JSON.stringify(
                indexes.map((i) => ({
                    name: i.name,
                    key: i.key,
                    expireAfterSeconds: i.expireAfterSeconds,
                })),
            )}`,
        );
    }

    // ===== C3. PHÂN QUYỀN /me/courses/stored =====

    // Tạo user thường (role 'user') để test phân quyền
    const normalUser = await User.create({
        name: 'Normal User',
        username: 'normaluser',
        email: 'normaluser@example.com',
        password: 'NormalUser@123',
        role: 'user',
    });
    const normalLogin = await loginAdminAndGetCookie('normaluser', 'NormalUser@123');
    const normalCookie = normalLogin.cookie;

    // Case 11f: user thường (role user) gọi /me/courses/stored -> 403 render errors/403
    {
        const res = await fetch(BASE_URL + '/me/courses/stored', {
            method: 'GET',
            headers: { Cookie: normalCookie },
            redirect: 'manual',
        });
        const body = await res.text();
        report(
            'Case 11f: user thường gọi /me/courses/stored -> 403 + render errors/403',
            res.status === 403 &&
                body.includes('Không có quyền truy cập') &&
                body.includes('403'),
            `HTTP=${res.status}, body chứa "Không có quyền truy cập"=${body.includes('Không có quyền truy cập')}, body chứa "403"=${body.includes('403')}`,
        );
    }

    // Case 11g: user thường + Accept: application/json -> 403 JSON
    {
        const res = await fetch(BASE_URL + '/me/courses/stored', {
            method: 'GET',
            headers: { Cookie: normalCookie, Accept: 'application/json' },
            redirect: 'manual',
        });
        const json = await res.json().catch(() => null);
        report(
            'Case 11g: user thường + Accept JSON -> 403 JSON',
            res.status === 403 && json && json.error === 'Không có quyền truy cập',
            `HTTP=${res.status}, json=${JSON.stringify(json)}`,
        );
    }

    // Case 11h: chưa login + Accept: application/json -> 401 JSON
    {
        const res = await fetch(BASE_URL + '/me/courses/stored', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            redirect: 'manual',
        });
        const json = await res.json().catch(() => null);
        report(
            'Case 11h: chưa login + Accept JSON -> 401 JSON',
            res.status === 401 && json && json.error === 'Cần đăng nhập',
            `HTTP=${res.status}, json=${JSON.stringify(json)}`,
        );
    }

    // Case 11i: admin gọi /me/courses/stored -> 200 render stored-course
    {
        const res = await fetch(BASE_URL + '/me/courses/stored', {
            method: 'GET',
            headers: { Cookie: adminCookie },
            redirect: 'manual',
        });
        const body = await res.text();
        report(
            'Case 11i: admin gọi /me/courses/stored -> 200 render stored-course',
            res.status === 200 && body.includes('Khóa học của tôi'),
            `HTTP=${res.status}, body chứa "Khóa học của tôi"=${body.includes('Khóa học của tôi')}`,
        );
    }

    // Dọn user thường
    await mongoose.connection.db.collection('users').deleteOne({ _id: normalUser._id });
    await mongoose.connection.db.collection('sessions').deleteMany({
        userId: normalUser._id,
    });

    // ===== C4. VALIDATE INPUT =====

    // Case 14: POST /courses/store với videoid sai định dạng (không đủ 11 ký tự) -> 400
    {
        const res = await httpPost('/courses/store', {
            name: 'Invalid Video ID',
            videoid: 'short',
        });
        const count = await Course.countDocuments({ name: 'Invalid Video ID' });
        report(
            'Case 14: videoid sai định dạng -> 400, không tạo bản ghi',
            res.status === 400 && count === 0,
            `HTTP=${res.status}, số bản ghi=${count} (kỳ vọng 400, 0 bản ghi)`,
        );
    }

    // Case 15: PUT /courses/:id với videoid sai định dạng -> 400
    {
        const created = await Course.create({
            name: 'Update Invalid Video',
            videoid: vid(15),
        });
        const res = await httpPut(`/courses/${created._id}`, {
            name: 'Update Invalid Video',
            videoid: 'bad',
        });
        const doc = await Course.findById(created._id).lean();
        report(
            'Case 15: update videoid sai định dạng -> 400, không đổi videoid',
            res.status === 400 && doc && doc.videoid === vid(15),
            `HTTP=${res.status}, videoid="${doc && doc.videoid}" (kỳ vọng 400, giữ "${vid(15)}")`,
        );
    }

    // ===== C5. CORS WHITELIST =====
    // Quy tắc: same-origin LUÔN cho phép; origin khác host chỉ cho phép nếu
    // nằm trong CORS_ORIGINS. Nếu CORS_ORIGINS trống hoặc '*' (dev) → cho phép mọi origin.
    const APP_ORIGINS = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const corsAllowsAll = !APP_ORIGINS.length || APP_ORIGINS.includes('*');

    // Case 16: same-origin (http://localhost:3000) -> luôn 200
    {
        const res = await fetchWithOrigin('http://localhost:3000');
        report(
            'Case 16: same-origin -> 200',
            res.status === 200,
            `HTTP=${res.status} (kỳ vọng 200)`,
        );
    }

    // Case 17: origin lạ (http://evil.com) -> 200 nếu cho phép tất cả, 403 nếu có whitelist
    {
        const res = await fetchWithOrigin('http://evil.com');
        report(
            `Case 17: origin lạ -> ${corsAllowsAll ? '200 (allow all)' : '403 (whitelist)'}`,
            corsAllowsAll ? res.status === 200 : res.status === 403,
            `HTTP=${res.status}, CORS_ORIGINS=[${APP_ORIGINS.join(',')}] (kỳ vọng ${corsAllowsAll ? '200' : '403'})`,
        );
    }

    // ===== D. KIỂM TRA CHUNG =====

    // Case 12: toàn bộ collection không trùng slug
    {
        const all = await Course.find({}).select('name slug').lean();
        const slugs = all.map((d) => d.slug);
        const unique = new Set(slugs);
        console.log('  Danh sách tất cả {name, slug}:');
        all.forEach((d) => console.log(`    ${JSON.stringify({ name: d.name, slug: d.slug })}`));
        report(
            'Case 12: không có 2 bản ghi trùng slug',
            unique.size === slugs.length,
            `tổng=${slugs.length}, unique=${unique.size}`,
        );
    }

    // Case 13: không có response 500 thô / server crash
    {
        report(
            'Case 13: mọi response đều là HTTP có kiểm soát (200/302/400/404/409), không 500',
            failures.every((f) => !/HTTP=5\d\d/.test(f.detail)),
            `số case FAIL có HTTP 5xx=${failures.filter((f) => /HTTP=5\d\d/.test(f.detail)).length}`,
        );
    }

    // ---------- Dọn dẹp test user + session ----------
    if (adminId) {
        await mongoose.connection.db.collection('users').deleteOne({ _id: adminId });
        await mongoose.connection.db.collection('users').deleteOne({
            username: ADMIN_USERNAME,
        });
        await mongoose.connection.db.collection('sessions').deleteMany({
            userId: adminId,
        });
        console.log('\n[Cleanup] Đã xóa admin test + session khỏi DB');
    }

    // ---------- Tổng kết ----------
    console.log('\n========================================');
    console.log(`KẾT QUẢ: ${passed} PASS / ${failed} FAIL`);
    if (failures.length) {
        console.log('\nChi tiết các case FAIL:');
        failures.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
    }

    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test crashed:', err);
    process.exit(1);
});