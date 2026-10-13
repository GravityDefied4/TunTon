/* MySQL connection pool. Use ? placeholders in EVERY query (plan rule 3):
     const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [id]); */
const mysql = require('mysql2/promise');

module.exports = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,          // a limited app user, not root
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'tunton',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,        // DECIMAL columns (lat, lng, score) come back as numbers, not strings
  dateStrings: ['DATE']        // event_date stays 'YYYY-MM-DD' (no timezone shifting)
});
