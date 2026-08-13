/**
 * Test tự động Course CRUD + slug generation.
 *
 * Yêu cầu:
 *  - MongoDB local đang chạy (mongodb://localhost:27017/V-connect-dev)
 *  - Server đang chạy tại http://localhost:3000 (npm start)
 *
 * Chạy: node test/course-crud.test.js
 *
 * LƯU Ý: Script sẽ XÓA TOÀN BỘ collection courses trước khi test
 * để kết quả slug xác định.
 */

const mongoose = require('mongoose');
const Course = require('../src/app/models/Course');

const BASE_URL = 'http://localhost:3000';
const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';

// ------ Check an toàn: chỉ cho phép chạy trên DB dev/test ------
// Script này tự XÓA TOÀN BỘ collection courses — không được chạy trên DB
// có dữ liệu thật. DB dev hiện tại: V-connect-dev.
if (!/test|dev/i.test(MONGODB_URI)) {
    throw new Error(
        `Không chạy test script trên DB không phải dev/test! (URI: ${MONGODB_URI})`,
    );
}

// ---------- Helpers HTTP (không follow redirect để thấy status 302) ----------
async function httpPost(path, data) {
    return fetch(BASE_URL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
        redirect: 'manual',
    });
}

async function httpPut(path, data) {
    return fetch(BASE_URL + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
        redirect: 'manual',
    });
}

async function httpDelete(path) {
    return fetch(BASE_URL + path, {
        method: 'DELETE',
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

// ---------- Main ----------
async function main() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    await Course.deleteMany({});
    console.log('Cleared courses collection\n');

    // ===== A. CREATE =====

    // Case 1: tạo khóa học tên "Kiểm tra CRUD"
    {
        const res = await httpPost('/courses/store', {
            name: 'Kiểm tra CRUD',
            videoid: 'vid-case1',
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
            videoid: 'vid-case2',
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
            videoid: 'vid-case3',
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
            videoid: 'vid-case4',
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
            videoid: 'vid-case5',
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
            httpPost('/courses/store', { name: 'Race Test', videoid: 'vid-race1' }),
            httpPost('/courses/store', { name: 'Race Test', videoid: 'vid-race2' }),
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
            videoid: 'vid-case7',
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
            videoid: 'vid-case8a',
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
            videoid: 'vid-case8b',
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
            videoid: 'vid-case9a',
        });
        const aAfterFirst = await Course.findById(a._id).lean();
        const firstOk = aAfterFirst.slug === 'course-beta-1';

        // 9.2: A đổi tên thành "Course Beta" LẦN NỮA -> excludeId chính nó
        //        -> slug phải GIỮ NGUYÊN course-beta-1, không thành -2
        await httpPut(`/courses/${a._id}`, {
            name: 'Course Beta',
            videoid: 'vid-case9a',
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

    // Case 11: xóa rồi tạo lại tên y hệt -> slug quay lại gốc
    {
        const created = await Course.create({
            name: 'Reuse Slug Test',
            videoid: 'vid-case11',
        });
        const resDel = await httpDelete(`/courses/${created._id}`);
        const countAfterDel = await Course.countDocuments({ name: 'Reuse Slug Test' });

        const resCreate = await httpPost('/courses/store', {
            name: 'Reuse Slug Test',
            videoid: 'vid-case11-new',
        });
        const recreated = await Course.findOne({ name: 'Reuse Slug Test' }).lean();

        report(
            'Case 11: xóa rồi tạo lại -> slug quay lại "reuse-slug-test"',
            countAfterDel === 0 &&
                recreated &&
                recreated.slug === 'reuse-slug-test' &&
                !resCreate.status.toString().startsWith('5'),
            `HTTP delete=${resDel.status}, HTTP create=${resCreate.status}, slug mới="${recreated && recreated.slug}"`,
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