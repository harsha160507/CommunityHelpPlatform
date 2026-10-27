"use strict";
require("dotenv").config();
const mysql = require("mysql2/promise");
function createPool(env = process.env) {
  for (const key of ["DB_USER", "DB_NAME"])
    if (!env[key]) throw new Error(key + " is required.");
  if (
    env.NODE_ENV === "production" &&
    (env.DB_USER === "root" || !env.DB_PASSWORD)
  )
    throw new Error(
      "Production requires a dedicated database user and password.",
    );
  const pool = mysql.createPool({
    host: env.DB_HOST || "127.0.0.1",
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD || "",
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 100,
    dateStrings: ["DATE"],
    timezone: "Z",
    charset: "utf8mb4",
    multipleStatements: false,
  });
  pool.on("connection", (connection) =>
    connection.query("SET time_zone = '+00:00'"),
  );
  return pool;
}
async function transaction(pool, action) {
  const connection = await pool.getConnection();
  // Read committed avoids a stale snapshot after the organizer/event lock waits.
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
module.exports = { createPool, transaction };
