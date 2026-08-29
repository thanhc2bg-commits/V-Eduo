const mongoose = require('mongoose');
const { generateUniqueSlug } = require('../../utils/slugify');
const mongooseDelete = require('mongoose-delete');
const Schema = mongoose.Schema;

const Course = new Schema(
    {
        name: {
            type: String,
            maxLength: 255,
            required: [true, 'Tên khóa học không được để trống'],
            trim: true,
            validate: {
                validator: (value) => value.trim().length > 0,
                message: 'Tên khóa học không được để trống',
            },
        },
        description: { type: String },
        image: { type: String },
        level: { type: String },
        slug: { type: String, unique: true },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false,
        },
        roadmapId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Roadmap',
            required: false,
        },
        roadmapOrder: {
            type: Number,
            required: false,
            default: null,
        },
        isPublic: { type: Boolean, default: true },
        // 🔒 Opt-in: chủ course phải chủ động bật "Cấp chứng chỉ khi hoàn thành"
        // thì issueCertificate() mới được gọi. Mặc định FALSE — course cũ (đã tồn tại
        // trước khi field này ra đời) sẽ KHÔNG tự động phát chứng chỉ ngoài ý muốn.
        certificate: { type: Boolean, default: false },
    },
    {
        timestamps: true,
    },
);

// Tự sinh slug unique trước khi lưu (this là Document)
Course.pre('save', async function () {
    if (this.isModified('name') || !this.slug) {
        this.slug = await generateUniqueSlug(
            mongoose.model('Course'),
            this.name,
            this._id,
        );
    }
});

// Tự sinh slug unique trước khi cập nhật (this là Query object)
Course.pre('findOneAndUpdate', async function () {
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
Course.pre('updateOne', async function () {
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

Course.plugin(mongooseDelete, {
    deletedAt: true,
    overrideMethods: 'all',
});

Course.index({ roadmapId: 1, roadmapOrder: 1, createdAt: 1 });

// TODO (chưa fix trong đợt này): pre('findOneAndUpdate') chỉ đúng khi query theo _id.
// Nếu query theo slug thì excludeId = undefined -> slug tự thêm hậu tố lạ.
// Hiện không route nào dùng findOneAndUpdate nên để nguyên, ghi chú lại.

module.exports = mongoose.model('Course', Course);
