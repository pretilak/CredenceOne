// middleware/loadCurrencies.js
const db = require("../config/db");
module.exports = async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT code, name, symbol
      FROM currencies
      ORDER BY code
    `);

    res.locals.currencies = result.rows;  // 🔥 available in ALL views
    next();

  } catch (err) {
    next(err);
  }
};