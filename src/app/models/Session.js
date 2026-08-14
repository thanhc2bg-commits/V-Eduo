const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Session = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        refreshToken: { type: String, required: true, unique: true },
        expiresAt: { type: Date, required: true },
    },
    {
        timestamps: true,
    },
);

// TTL index — MongoDB tự xóa session hết hạn (không cần cron job dọn thủ công)
Session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// KHÔNG dùng mongoose-delete cho Session — session hết hạn nên bị xóa hẳn,
// không cần thùng rác.

module.exports = mongoose.model('Session', Session);
