const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CourseReview = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true,
        },
        rating: {
            type: Number,
            required: [true, 'Vui lòng chọn số sao'],
            min: [1, 'Rating tối thiểu 1 sao'],
            max: [5, 'Rating tối đa 5 sao'],
        },
        comment: {
            type: String,
            maxLength: 2000,
            trim: true,
            default: '',
        },
    },
    { timestamps: true },
);

// 1 user chỉ đánh giá 1 lần cho 1 khóa học — chống spam rating
CourseReview.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('CourseReview', CourseReview);
