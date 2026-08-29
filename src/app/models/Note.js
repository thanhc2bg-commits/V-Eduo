const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Note = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        videoId: {
            type: Schema.Types.ObjectId,
            ref: 'Video',
            required: true,
            index: true,
        },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        content: {
            type: String,
            required: [true, 'Nội dung ghi chú không được để trống'],
            maxLength: 5000,
            trim: true,
        },
    },
    { timestamps: true },
);

Note.index({ userId: 1, videoId: 1, createdAt: -1 });
module.exports = mongoose.model('Note', Note);
