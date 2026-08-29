const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Video = new Schema(
    {
        youtubeId: { type: String, required: true },
        moduleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Module',
            required: true,
            index: true,
        },
        title: { type: String, required: true, trim: true },
        order: { type: Number, default: 0 },
        duration: { type: String },
        aiSubtitles: { type: String, default: null },
        aiDubbing: { type: String, default: null },
    },
    {
        timestamps: true,
    },
);

// Cho phép 1 video (youtubeId) xuất hiện ở nhiều khóa học/module khác nhau,
// nhưng KHÔNG cho phép trùng trong cùng 1 module — ràng buộc cứng ở DB,
// bổ sung cho bước dedup ở tầng ứng dụng (storePlaylist), tránh race condition
// khi 2 request submit đồng thời cùng module.
Video.index({ youtubeId: 1, moduleId: 1 }, { unique: true });

module.exports = mongoose.model('Video', Video);
