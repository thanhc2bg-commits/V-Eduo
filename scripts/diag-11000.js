require('dotenv').config();
const mongoose = require('mongoose');
const Course = require('../src/app/models/Course');
const Module = require('../src/app/models/Module');
const Video = require('../src/app/models/Video');

const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';

async function main() {
    await mongoose.connect(MONGODB_URI);

    console.log('=== DIAG 1: 2 Course.save() ĐỒNG THỜI cùng tên (mô phỏng storePlaylist) ===');
    const name = `Diag Course ${Date.now()}`;
    const courseA = new Course({
        name,
        description: 'diag',
        createdBy: new mongoose.Types.ObjectId(),
        certificate: false,
    });
    const courseB = new Course({
        name,
        description: 'diag',
        createdBy: new mongoose.Types.ObjectId(),
        certificate: false,
    });
    try {
        await Promise.all([courseA.save(), courseB.save()]);
        console.log('Kết quả: CẢ HAI SAVE THÀNH CÔNG (bất ngờ)');
    } catch (err) {
        if (err.code === 11000) {
            console.log('E11000 xảy ra!');
            console.log('code:', err.code);
            console.log('keyPattern:', JSON.stringify(err.keyPattern));
            console.log('keyValue:', JSON.stringify(err.keyValue));
            console.log(
                'message:',
                err.message.split('\n')[0] || err.message,
            );
        } else {
            console.log('Lỗi khác:', err.message);
        }
    }

    console.log('\n=== TEST 2: Video.insertMany — 2 module khác nhau, cùng youtubeId ===');
    const course = new Course({
        name: `Diag Course 2 ${Date.now()}`,
        description: 'diag',
        createdBy: new mongoose.Types.ObjectId(),
        certificate: false,
    });
    await course.save();
    const m1 = await Module.create({ name: 'M1', courseId: course._id, order: 0 });
    const m2 = await Module.create({ name: 'M2', courseId: course._id, order: 1 });
    const sharedYt = 'diag1122aB-';
    // đảm bảo đúng 11 ký tự
    const youtubeId = sharedYt.slice(0, 11);
    try {
        await Promise.all([
            Video.insertMany(
                [{ youtubeId, moduleId: m1._id, title: 'V1', order: 0 }],
                { ordered: false },
            ),
            Video.insertMany(
                [{ youtubeId, moduleId: m2._id, title: 'V2', order: 0 }],
                { ordered: false },
            ),
        ]);
        const count = await Video.countDocuments({ youtubeId });
        console.log(
            `Kết quả: CẢ 2 INSERT THÀNH CÔNG, số document cho ${youtubeId}: ${count} (mô phỏng thành công kịch bản video dùng lại)`,
        );
    } catch (err) {
        if (err.code === 11000) {
            console.log('E11000 xảy ra trên Video!');
            console.log('code:', err.code);
            console.log('keyPattern:', JSON.stringify(err.keyPattern));
            console.log('keyValue:', JSON.stringify(err.keyValue));
        } else {
            console.log('Lỗi khác:', err.message);
        }
    }

    await mongoose.disconnect();
    process.exit(0);
}

main().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
});