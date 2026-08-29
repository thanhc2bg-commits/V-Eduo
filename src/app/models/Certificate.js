const crypto = require('crypto');
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Certificate = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        certificateId: {
            type: String,
            unique: true,
            required: true,
            // 🔒 Tạo ID ngẫu nhiên khó đoán (128-bit entropy) — chống quét/giả mạo.
            // KHÔNG dùng _id của Mongo (dễ đoán, dễ quét).
            default: () => crypto.randomBytes(16).toString('hex'),
        },
        // Giai đoạn 2 (mở rộng — BẢN 2.1 XÁC NHẬN):
        // isPublic mặc định TRUE — certificate cũ (giai đoạn 1, không có field này)
        // vẫn được coi là public khi query (fallback undefined → true), không phá vỡ
        // certificate đã cấp trước đó.
        isPublic: { type: Boolean, default: true },
    },
    { timestamps: true },
);

// 1 user chỉ có 1 chứng chỉ / 1 khóa — idempotent
Certificate.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('Certificate', Certificate);
