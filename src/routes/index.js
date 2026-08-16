const newsRouter = require('./news');
const siteRouter = require('./site');
const courseRouter = require('./courses');
const meRouter = require('./me');
const authRouter = require('./auth');
const roadmapRouter = require('./roadmaps');
const moduleRouter = require('./modules');
const videoRouter = require('./videos');
function route(app) {
    app.use('/news', newsRouter);
    app.use('/courses', courseRouter);
    app.use('/me', meRouter);
    app.use('/auth', authRouter);
    app.use('/roadmaps', roadmapRouter);
    app.use('/modules', moduleRouter);
    app.use('/videos', videoRouter);
    app.use('/', siteRouter);

    // Route catch-all 404 — phải đặt SAU CÙNG, sau tất cả các route khác
    app.use((req, res) => {
        res.status(404).render('errors/404', {
            layout: false,
            error: 'Trang bạn tìm kiếm không tồn tại hoặc đã bị di chuyển',
        });
    });
}

module.exports = route;
