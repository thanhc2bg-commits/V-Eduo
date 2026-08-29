const Course = require('../models/Course');

const COURSE_LEVELS = ['Cơ bản', 'Trung bình', 'Nâng cao'];

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class SiteController {
    //[GET] /
    async index(req, res, next) {
        try {
            const q = String(req.query.q || '').trim().slice(0, 120);
            const requestedLevel = String(req.query.level || '').trim();
            const selectedLevel = COURSE_LEVELS.includes(requestedLevel)
                ? requestedLevel
                : '';
            const filter = { isPublic: { $ne: false } };

            if (q) {
                const search = new RegExp(escapeRegExp(q), 'i');
                filter.$or = [{ name: search }, { description: search }];
            }
            if (selectedLevel) filter.level = selectedLevel;

            const courses = await Course.find(filter)
                .sort({ createdAt: -1 })
                .lean();

            res.render('home', {
                title: q ? `Tìm kiếm: ${q}` : 'Khóa học',
                courses,
                q,
                selectedLevel,
                hasFilters: Boolean(q || selectedLevel),
            });
        } catch (error) {
            next(error);
        }
    }

    //[GET] /search
    search(req, res) {
        const params = new URLSearchParams();
        if (req.query.q) params.set('q', String(req.query.q));
        if (req.query.level) params.set('level', String(req.query.level));
        const suffix = params.toString();
        res.redirect(suffix ? `/courses?${suffix}` : '/courses');
    }
}

module.exports = new SiteController();
