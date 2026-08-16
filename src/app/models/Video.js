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

module.exports = mongoose.model('Video', Video);
