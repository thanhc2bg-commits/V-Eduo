const mongoose = require('mongoose');

function slugify(str) {
    const base = (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
    return base || `course-${Date.now()}`;
}

async function generateUniqueSlug(Model, name, excludeId = null) {
    const base = slugify(name);
    let slug = base;
    let count = 1;
    // Model.collection là raw MongoDB collection — không bị mongoose-delete override,
    // nên thấy cả bản đã soft-delete (tránh E11000 khi tạo lại cùng tên).
    const collection = Model.collection;
    while (true) {
        const query = { slug };
        if (excludeId) {
            // Raw collection không auto-cast ObjectId như Mongoose query.
            // Cast thủ công để $ne khớp đúng _id (tránh excludeId vô hiệu).
            query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
        }
        const exists = await collection.findOne(query);
        if (!exists) return slug;
        slug = `${base}-${count++}`;
    }
}

module.exports = { slugify, generateUniqueSlug };
