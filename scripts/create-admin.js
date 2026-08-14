require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/app/models/User');

const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';

const name = process.env.ADMIN_NAME || 'Admin';
const username = process.env.ADMIN_USERNAME;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!username || !email || !password) {
    console.error(
        'Thiếu biến môi trường: cần ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD trong .env',
    );
    process.exit(1);
}
if (password.length < 8) {
    console.error('ADMIN_PASSWORD phải có ít nhất 8 ký tự');
    process.exit(1);
}

(async () => {
    await mongoose.connect(MONGODB_URI);

    // Check trùng (kể cả soft-delete) — dùng raw collection
    const existing = await User.collection.findOne({
        $or: [
            { username: String(username).trim().toLowerCase() },
            { email: String(email).trim().toLowerCase() },
        ],
    });
    if (existing) {
        console.log('Admin đã tồn tại, bỏ qua (không tạo mới)');
        await mongoose.disconnect();
        process.exit(0);
    }

    const admin = new User({
        name: String(name).trim(),
        username: String(username).trim().toLowerCase(),
        email: String(email).trim().toLowerCase(),
        password,
        role: 'admin',
    });
    await admin.save();
    console.log(`Đã tạo admin: ${admin.username} (${admin.email})`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});