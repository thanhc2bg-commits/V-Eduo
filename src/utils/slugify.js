function slugify(str) {
    return (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

async function generateUniqueSlug(Model, name, excludeId = null) {
    const base = slugify(name);
    let slug = base;
    let count = 1;
    while (true) {
        const query = { slug };
        if (excludeId) query._id = { $ne: excludeId };
        const exists = await Model.exists(query);
        if (!exists) return slug;
        slug = `${base}-${count++}`;
    }
}

module.exports = { slugify, generateUniqueSlug };
