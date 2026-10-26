
const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "community_help",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4"
});

async function testConnection() {
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log("MySQL database connected successfully.");
  } catch (error) {
    console.error("MySQL connection failed:", error.message);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  testConnection
};
