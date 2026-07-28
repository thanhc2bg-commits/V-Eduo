const path = require('path');
const express = require('express');
const app = express();
const morgan = require('morgan');
const handlebars = require('express-handlebars');
const port = 3000;
const route = require('./routes');
// cấu hình file static
app.use(express.static(path.join(__dirname, 'public')));
//tích hợp middleware
app.use(express.urlencoded({
  extended: true
}));
app.use(express.json());
// bootstrap 5
app.use('/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));

// HTTP logger
//app.use(morgan('combined'))

// Handlebars
app.engine('hbs', handlebars.engine({extname: '.hbs'}));
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname,'resources\\views'));

//routes init
route(app);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});