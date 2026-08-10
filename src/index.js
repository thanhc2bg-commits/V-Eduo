const path = require('path');
const express = require('express');
const app = express();
const morgan = require('morgan');
const methodOverride = require('method-override');
const handlebars = require('express-handlebars');
const port = 3000;
const route = require('./routes');
const db = require('./config/db');
//connect to db
db.connect();

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
        },
    }),
);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, 'resources', 'views'));

//routes init
route(app);

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
