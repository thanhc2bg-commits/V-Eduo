const mongoose = require('mongoose');
const { generateUniqueSlug } = require('../../utils/slugify');
const mongooseDelete = require('mongoose-delete');
const Schema = mongoose.Schema;

const Roadmap = new Schema(
    {
        name: {
            type: String,
            maxLength: 255,
            required: [true, 'Tên lộ trình không được để trống'],
            trim: true,
            validate: {
                validator: (value) => value.trim().length > 0,
                message: 'Tên lộ trình không được để trống',
            },
        },
        description: { type: String },
        slug: { type: String, unique: true },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        isPublic: { type: Boolean, default: true },
        visibility: {
            type: String,
            enum: ['public', 'private', 'draft'],
            default: 'public',
            index: true,
        },
        category: {
            type: String,
            maxLength: 120,
            default: '',
            trim: true,
        },
        difficulty: {
            type: String,
            maxLength: 120,
            default: '',
            trim: true,
        },
        coverImage: {
            type: String,
            default: '',
            trim: true,
        },
    },
    {
        timestamps: true,
    },
);

// Tự sinh slug unique trước khi lưu (this là Document)
Roadmap.pre('save', async function () {
    if (this.isModified('name') || !this.slug) {
        this.slug = await generateUniqueSlug(
            mongoose.model('Roadmap'),
            this.name,
            this._id,
        );
    }
});

// Tự sinh slug unique trước khi cập nhật (this là Query object)
Roadmap.pre('findOneAndUpdate', async function () {
    const query = this.getQuery();
    const update = this.getUpdate();
    const newName = update.name || (update.$set && update.$set.name);

    if (newName) {
        const docId = query._id;
        const slug = await generateUniqueSlug(this.model, newName, docId);
        if (update.$set) {
            update.$set.slug = slug;
        } else {
            update.slug = slug;
        }
    }
});

// Tự sinh slug unique trước khi cập nhật bằng updateOne
// Chỉ sinh slug khi name thực sự được gửi lên và không rỗng sau trim.
// - Không gửi name (undefined): giữ nguyên slug cũ.
// - Gửi name rỗng/space: KHÔNG set slug ở đây, để runValidators
//   (đặt ở controller) bắt lỗi ValidationError và trả HTTP 400.
Roadmap.pre('updateOne', async function () {
    const query = this.getQuery();
    const update = this.getUpdate();
    const rawName =
        update.name !== undefined
            ? update.name
            : update.$set && update.$set.name;

    if (typeof rawName === 'string' && rawName.trim().length > 0) {
        const docId = query._id;
        const slug = await generateUniqueSlug(this.model, rawName, docId);
        if (update.$set) {
            update.$set.slug = slug;
        } else {
            update.slug = slug;
        }
    }
});

Roadmap.plugin(mongooseDelete, {
    deletedAt: true,
    overrideMethods: 'all',
});

Roadmap.index({ createdBy: 1, visibility: 1, createdAt: -1 });

module.exports = mongoose.model('Roadmap', Roadmap);
