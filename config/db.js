const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
    //ssl: {rejectUnauthorized: false}
});

async function checkConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log("✅ Pool connected! Server time:", res.rows[0].now);
  } catch (err) {
    console.error("❌ Database connection error:", err.stack);
  }
}

checkConnection();

module.exports = pool;