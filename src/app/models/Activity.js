const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Activity = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            enum: [
                'video_started',
                'video_completed',
                'course_enrolled',
                'course_completed',
                'certificate_issued',
                'review_submitted',
            ],
        },
        videoId: { type: Schema.Types.ObjectId, ref: 'Video', default: null },
        courseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null },
        metadata: { type: Schema.Types.Mixed, default: {} },
    },
    { timestamps: true },
);

// Lịch sử xem: query theo user + time
Activity.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', Activity);
