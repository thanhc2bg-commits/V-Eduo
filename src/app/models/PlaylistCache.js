const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PlaylistCache = new Schema({
    playlistId: { type: String, required: true, unique: true },
    videos: { type: Array, required: true },
    truncated: { type: Boolean, default: false },
    fetchedAt: { type: Date, default: Date.now, expires: 300 }, // TTL 5 phút (300 giây)
});

module.exports = mongoose.model('PlaylistCache', PlaylistCache);
