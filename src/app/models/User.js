const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const mongooseDelete = require('mongoose-delete');
const Schema = mongoose.Schema;

const User = new Schema(
    {
        name: { type: String, required: true, trim: true },
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            minLength: [3, 'Tên đăng nhập phải có ít nhất 3 ký tự'],
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            validate: {
                validator: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
                message: 'Email không đúng định dạng',
            },
        },
        password: {
            type: String,
            required: true,
            select: false,
            minLength: [8, 'Mật khẩu phải có ít nhất 8 ký tự'],
        },
        role: { type: String, enum: ['user', 'admin'], default: 'user' },
    },
    {
        timestamps: true,
    },
);

// Hash password trước khi lưu — chỉ hash khi password bị modify
User.pre('save', async function () {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

// So sánh password: dùng phương thức này thay vì trả password ra ngoài
User.methods.comparePassword = function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

User.plugin(mongooseDelete, {
    deletedAt: true,
    overrideMethods: 'all',
});

module.exports = mongoose.model('User', User);
