const mongoose = require('mongoose');
const { generateUniqueSlug } = require('../../utils/slugify');

const Schema = mongoose.Schema;

const Course = new Schema(
    {
        name: { type: String, maxLength: 255 },
        description: { type: String },
        image: { type: String },
        videoid: { type: String, required: true },
        level: { type: String },
        slug: { type: String, unique: true },
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

module.exports = mongoose.model('Course', Course);
