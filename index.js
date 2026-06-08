const express = require("express");
const expressLayouts = require("express-ejs-layouts");
require("dotenv").config();
const session = require("express-session");
const pgSession = require('connect-pg-simple')(session);

const app = express();

app.use(session({
  store: new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'user_sessions'
  }),
  secret: '1234',
  resave: false,
  saveUninitialized: false,

  rolling: true, // 🔥 THIS enables inactivity timeout

  cookie: {
    maxAge: 15 * 60 * 1000 // 15 minutes idle timeout
  }
}));

// Apply permissions and user details globally
app.use((req, res, next) => {

  res.locals.title = "CredenceOne";

  res.locals.user = req.session.user || null;

  res.locals.permissions = req.session?.user?.permissions || [];

  next();
});


/* app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
}); */

//parse form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }))

app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.static("public"));

const signUpInRouter = require('./routes/signUpInRouter');
app.use(signUpInRouter);

// Set default title
/* app.use((req, res, next) => {
  res.locals.title = "CredenceOne";
  res.locals.user = req.session?.user || null;
  next();
}); */





// Active menu middleware
app.use((req, res, next) => {
  res.locals.activePage = req.path.split("/")[1] || "dashboard";
  next();
});

// Load currencies into locals
const loadCurrencies = require('./middlewares/loadCurrencies');
app.use(loadCurrencies);

//routes
const dashboardRouter = require('./routes/dashboardRouter');
app.use(dashboardRouter);

const accountRouter = require('./routes/accountRoutes');
app.use(accountRouter);

const settingsRouter = require('./routes/settingsRouter');
app.use(settingsRouter);

app.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'CredenceOne'
  });
});

//404
app.use((req, res) => {
  res.status(404).render("404");
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});