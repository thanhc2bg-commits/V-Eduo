require('dotenv').config();
const path = require('path');
const express = require('express');
const app = express();
const morgan = require('morgan');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const handlebars = require('express-handlebars');
const helmet = require('helmet');
const port = process.env.PORT || 3000;
const route = require('./routes');
const db = require('./config/db');
const { attachUser } = require('./app/middlewares/auth');
const { csrfToken, csrfProtection } = require('./app/middlewares/csrf');
const corsMiddleware = require('./app/middlewares/cors');

// Fail-fast: từ chối khởi động nếu thiếu cấu hình bắt buộc (tránh chạy sai âm thầm)
if (!process.env.JWT_SECRET) {
    throw new Error('Thiếu JWT_SECRET trong .env');
}
if (!process.env.MONGODB_URI) {
    throw new Error('Thiếu MONGODB_URI trong .env');
}

// Tin tưởng 1 hop proxy đầu tiên (Nginx/PM2/Render/Heroku...) để:
// - rate-limit đọc đúng IP thật của user (X-Forwarded-For)
// - CORS same-origin so sánh đúng host
// - cookie secure hoạt động khi proxy chuyển HTTPS → HTTP nội bộ
app.set('trust proxy', 1);

//connect to db
db.connect();

// Bảo mật HTTP headers (CSP cấu hình cho phép oEmbed YouTube + thumbnail)
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    'https://cdnjs.cloudflare.com',
                ],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https://img.youtube.com'],
                connectSrc: ["'self'", 'https://www.youtube.com'],
                fontSrc: ["'self'", 'data:'],
                objectSrc: ["'none'"],
                frameSrc: ["'self'", 'https://www.youtube.com'],
                frameAncestors: ["'self'"],
            },
        },
    }),
);

// CORS whitelist (từ CORS_ORIGINS env)
app.use(corsMiddleware);

// app.get('/', (req, res) => {
//     res.render('home');
// });
// cấu hình file static
app.use(express.static(path.join(__dirname, 'public')));
//tích hợp middleware
app.use(
    express.urlencoded({
        extended: true,
    }),
);
app.use(express.json());
app.use(methodOverride('_method'));
app.use(cookieParser());

// CSRF: gắn token vào res.locals cho mọi request (GET render form dùng được)
app.use(csrfToken);

// Route dev-only: GET /dev/csrf-token — trả CSRF token JSON để test qua Postman.
// Chỉ hoạt động khi NODE_ENV !== 'production' (trả 404 nếu production).
// Đặt SAU app.use(csrfToken) để res.locals.csrfToken đã có giá trị.
// GET nên không bị chặn bởi csrfProtection (ignoredMethods: ['GET', 'HEAD', 'OPTIONS']).
const devRouter = require('./routes/dev');
app.use('/dev', devRouter);

// CSRF protection — chặn mọi request thay đổi (POST/PUT/PATCH/DELETE) thiếu token
app.use(csrfProtection);

// Gắn req.user + res.locals.user từ cookie token (chạy trước routes)
app.use(attachUser);
// bootstrap 5
app.use(
    '/bootstrap',
    express.static(
        path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist'),
    ),
);

// HTTP logger
//app.use(morgan('combined'))

// Handlebars
app.engine(
    'hbs',
    handlebars.engine({
        extname: '.hbs',
        helpers: {
            sum: (a, b) => a + b,
            eq: (a, b) => a === b,
            // Lặp n lần — dùng để render số sao (vd: {{#times 4}}★{{/times}})
            times: (n, options) => {
                const count = Number(n) || 0;
                let out = '';
                for (let i = 0; i < count; i++) {
                    out += options.fn(this);
                }
                return out;
            },
            // Format Date thành DD/MM/YYYY. Trả về '—' nếu null/undefined/invalid.
            formatDate: (date) => {
                if (!date) return '—';
                const d = new Date(date);
                if (isNaN(d.getTime())) return '—';
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return `${dd}/${mm}/${yyyy}`;
            },
            // Lấy năm hiện tại để hiển thị ở footer.
            getCurrentYear: () => new Date().getFullYear(),
        },
    }),
);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, 'resources', 'views'));

//routes init
route(app);

// Error handler tập trung: lỗi ValidationError của Mongoose -> 400 thay vì 500 thô
app.use((err, req, res, next) => {
    if (err.name === 'ValidationError' || err.name === 'CastError') {
        const messages = Object.values(err.errors || {}).map((e) => e.message);
        return res
            .status(400)
            .json({ error: 'Dữ liệu không hợp lệ', details: messages });
    }
    if (err.code === 11000) {
        return res
            .status(409)
            .json({ error: 'Trùng dữ liệu, vui lòng thử lại' });
    }
    console.error(err);
    // Request API (Accept: application/json) -> trả JSON
    // Request trang HTML -> render trang 500 riêng (standalone, không dùng layout)
    const wantsJson =
        req.headers.accept && req.headers.accept.includes('application/json');
    if (wantsJson) {
        return res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
    }
    res.status(500).render('errors/500', {
        layout: false,
        error: 'Đã có lỗi xảy ra, vui lòng thử lại sau',
    });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
