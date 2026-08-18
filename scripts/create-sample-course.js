require('dotenv').config();
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const mongoose = require('mongoose');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';

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

const client = makeClient().client;

async function getCsrf() {
    const res = await client.get('/dev/csrf-token');
    return res.data && res.data.csrfToken;
}

async function sendWithCsrf(method, url, body) {
    const token = await getCsrf();
    return client.request({
        method,
        url,
        data: body,
        headers: { 'x-csrf-token': token },
    });
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

(async () => {
    await mongoose.connect(MONGODB_URI);

    const Course = require('../src/app/models/Course');

    // 1. Đăng ký / đăng nhập owner
    const username = 'sample_owner';
    const register = await sendWithCsrf('post', '/auth/register', {
        name: 'Sample Owner',
        username,
        email: 'sample_owner@test.com',
        password: '12345678',
    });
    if (register.status !== 302) {
        await sendWithCsrf('post', '/auth/login', {
            identifier: username,
            password: '12345678',
        });
    }

    // 2. Tạo Course
    const courseVideoid = makeYoutubeId('s');
    const courseName = `Sample AJAX Course ${Date.now()}`;
    const store = await sendWithCsrf('post', '/courses/store', {
        name: courseName,
        videoid: courseVideoid,
        description: 'Khóa học mẫu để test chuyển video AJAX (không reload)',
    });
    if (store.status !== 302) {
        console.error('[FAIL] Tạo Course:', store.status, store.data);
        process.exit(1);
    }
    const courseDoc = await Course.findOne({ videoid: courseVideoid });
    const courseId = courseDoc._id.toString();
    const slug = courseDoc.slug;
    console.log('[OK] Course tạo:', courseName, '->', slug, '(' + courseId + ')');

    // 3. Tạo 2 Module
    const moduleIds = [];
    for (const name of ['Module 1', 'Module 2']) {
        const res = await sendWithCsrf('post', `/courses/${courseId}/modules`, {
            name,
        });
        if (res.status === 201 && res.data && res.data.module) {
            moduleIds.push(res.data.module._id);
            console.log('[OK] Module tạo:', name, res.data.module._id);
        } else {
            console.error('[FAIL] Tạo Module:', res.status, res.data);
            process.exit(1);
        }
    }

    // 4. Tạo 2 Video (1 video / module)
    const youtubeIds = ['dQw4w9WgXcQ', 'abc12345678'];
    const videoNames = ['Video Sample 1', 'Video Sample 2'];
    for (let i = 0; i < 2; i++) {
        const res = await sendWithCsrf(
            'post',
            `/modules/${moduleIds[i]}/videos`,
            { youtubeId: youtubeIds[i], title: videoNames[i] },
        );
        if (res.status === 201 && res.data && res.data.video) {
            console.log(
                '[OK] Video tạo:',
                videoNames[i],
                res.data.video._id,
                '(youtube:',
                youtubeIds[i] + ')',
            );
        } else {
            console.error('[FAIL] Tạo Video:', res.status, res.data);
            process.exit(1);
        }
    }

    console.log('\n===== TRUY CẬP =====');
    console.log(`http://localhost:3000/courses/${slug}`);

    await mongoose.disconnect();
    process.exit(0);
})().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});