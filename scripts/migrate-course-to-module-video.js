require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connect } = require('../src/config/db');
const Course = require('../src/app/models/Course');
const Module = require('../src/app/models/Module');
const Video = require('../src/app/models/Video');

const LOG_FILE = path.join(__dirname, 'migration-log.json');

async function main() {
    await connect();

    // Lấy TẤT CẢ Course kể cả đã soft-delete
    // findWithDeleted() do mongoose-delete cung cấp (overrideMethods: 'all')
    const courses = await Course.findWithDeleted({});
    const totalCourses = courses.length;

    const migrated = [];
    const skipped = [];
    const errors = [];

    for (const course of courses) {
        let module = null;
        try {
            // Kiểm tra idempotent: Course này đã có Module liên kết chưa?
            const existingModule = await Module.findOne({
                courseId: course._id,
            });
            if (existingModule) {
                skipped.push({
                    courseId: course._id.toString(),
                    reason: 'đã migrate trước đó',
                });
                continue;
            }

            // Tạo 1 Module mới
            module = new Module({
                name: 'Nội dung chính',
                courseId: course._id,
                order: 0,
            });
            await module.save();

            // Tạo 1 Video mới
            const video = new Video({
                youtubeId: course.videoid,
                moduleId: module._id,
                title: course.name,
                order: 0,
            });
            await video.save();

            migrated.push({
                courseId: course._id.toString(),
                courseName: course.name,
                moduleId: module._id.toString(),
                videoId: video._id.toString(),
            });
        } catch (err) {
            // Nếu Module đã save() nhưng Video thất bại → rollback: xóa cứng Module mồ côi
            // để lần chạy sau Course này được thử lại từ đầu, không bị skip nhầm.
            if (module && module._id) {
                try {
                    await Module.deleteOne({ _id: module._id });
                    console.log(
                        `Rollback Module mồ côi cho Course ${course._id} do lỗi tạo Video`,
                    );
                    errors.push({
                        courseId: course._id.toString(),
                        error: err.message,
                        rolledBack: true,
                    });
                } catch (rollbackErr) {
                    errors.push({
                        courseId: course._id.toString(),
                        error: err.message,
                        rolledBack: false,
                        rollbackError: rollbackErr.message,
                    });
                }
            } else {
                errors.push({
                    courseId: course._id.toString(),
                    error: err.message,
                });
            }
        }
    }

    // Ghi log ra file JSON
    const log = {
        timestamp: new Date().toISOString(),
        totalCourses,
        migrated,
        skipped,
        errors,
    };
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');

    // In tổng kết console
    console.log('=== MIGRATION COURSE → MODULE + VIDEO ===');
    console.log(`Tổng số Course: ${totalCourses}`);
    console.log(`Migrate thành công: ${migrated.length}`);
    console.log(`Skip (đã migrate trước đó): ${skipped.length}`);
    console.log(`Lỗi: ${errors.length}`);
    if (errors.length > 0) {
        console.log('\nChi tiết lỗi:');
        errors.forEach((e) => {
            console.log(`  - Course ${e.courseId}: ${e.error}`);
        });
    }
    console.log(`\nLog đã ghi tại: ${LOG_FILE}`);

    process.exit(0);
}

main().catch((err) => {
    console.error('Migration thất bại:', err);
    process.exit(1);
});