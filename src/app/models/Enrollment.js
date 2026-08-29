const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Enrollment = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['active', 'completed'],
            default: 'active',
        },
        completedVideoIds: {
            // Chỉ lưu ID video đã hoàn thành — mỗi video tối đa 1 lần
            type: [Schema.Types.ObjectId],
            default: [],
        },
        completedAt: { type: Date, default: null },
    },
    { timestamps: true },
);

// 1 user chỉ enroll 1 lần / 1 khóa học
Enrollment.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', Enrollment);
