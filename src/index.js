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
//connect to db
db.connect();

// Bảo mật HTTP headers (CSP cấu hình cho phép oEmbed YouTube + thumbnail)
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https://img.youtube.com'],
                connectSrc: ["'self'", 'https://www.youtube.com'],
                fontSrc: ["'self'", 'data:'],
                objectSrc: ["'none'"],
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
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
