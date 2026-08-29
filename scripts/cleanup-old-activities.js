require('dotenv').config();
const mongoose = require('mongoose');
const { connect } = require('../src/config/db');
const Activity = require('../src/app/models/Activity');

// ⚠️ JOB XÓA DỮ LIỆU HÀNG LOẠT — cẩn thận khi sửa.
//
// Mục đích: dọn các Activity (lịch sử xem) cũ hơn 90 ngày để tránh phình DB.
// Chỉ xóa các bản ghi có `createdAt` CŨ HƠN mốc 90 ngày trước.
//
// Điều kiện lọc BẮT BUỘC đúng:
//   - `createdAt: { $lt: cutoffDate }` — chỉ xóa bản ghi CŨ HƠN cutoff.
//   - KHÔNG được để ngược dấu (`$gt`) — sẽ xóa nhầm toàn bộ lịch sử mới.
//   - KHÔNG được bỏ điều kiện createdAt — sẽ xóa TOÀN BỘ collection.
//
// Chạy định kỳ (cron): `node scripts/cleanup-old-activities.js`
// Ví dụ cron mỗi ngày lúc 3h sáng: `0 3 * * * cd /path/to/V-Connect && node scripts/cleanup-old-activities.js`

const RETENTION_DAYS = Number(process.env.ACTIVITY_RETENTION_DAYS || 90);

async function main() {
    await connect();

    // Mốc thời gian: 90 ngày trước tính từ hiện tại
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    console.log(`=== CLEANUP OLD ACTIVITIES ===`);
    console.log(`Retention: ${RETENTION_DAYS} ngày`);
    console.log(`Cutoff: ${cutoffDate.toISOString()}`);

    // 🔒 Điều kiện lọc: chỉ xóa bản ghi CŨ HƠN cutoff (createdAt < cutoff)
    // KHÔNG xóa bản ghi mới hơn hoặc bằng cutoff.
    const filter = { createdAt: { $lt: cutoffDate } };

    // Đếm trước để báo cáo (không xóa gì ở bước này)
    const count = await Activity.countDocuments(filter);
    console.log(`Số bản ghi sẽ xóa: ${count}`);

    if (count === 0) {
        console.log('Không có gì để dọn.');
        await mongoose.disconnect();
        return;
    }

    // Xóa theo batch để tránh lock DB lâu (mỗi batch 5000 bản ghi)
    let deletedTotal = 0;
    const BATCH_SIZE = 5000;
    let hasMore = true;

    while (hasMore) {
        // Tìm 1 batch ID trước (chỉ lấy _id, không tải toàn bộ document)
        const batch = await Activity.find(filter)
            .select('_id')
            .limit(BATCH_SIZE)
            .lean();

        if (batch.length === 0) {
            hasMore = false;
            break;
        }

        const ids = batch.map((a) => a._id);
        const result = await Activity.deleteMany({ _id: { $in: ids } });
        deletedTotal += result.deletedCount || 0;
        console.log(`Đã xóa batch: ${deletedTotal}/${count}`);

        // Nếu batch < BATCH_SIZE nghĩa là hết
        if (batch.length < BATCH_SIZE) {
            hasMore = false;
        }
    }

    console.log(`=== HOÀN TẤT: đã xóa ${deletedTotal} bản ghi activity cũ hơn ${RETENTION_DAYS} ngày ===`);
    await mongoose.disconnect();
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Cleanup thất bại:', err.message);
        process.exit(1);
    });