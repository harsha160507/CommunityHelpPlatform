"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPool } = require("../src/db");
const migrations = ["001_initial.sql", "002_hardening.js", "003_services.sql"];
async function migrate(pool) {
  const db = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await db.query(
      "SELECT GET_LOCK(CONCAT(DATABASE(),':chp_migrate'),30) AS acquired",
    );
    if (Number(lock.acquired) !== 1)
      throw new Error("Another migration is running.");
    locked = true;
    await db.query(
      "CREATE TABLE IF NOT EXISTS chp_schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    );
    for (const name of migrations) {
      const [done] = await db.execute(
        "SELECT name FROM chp_schema_migrations WHERE name=?",
        [name],
      );
      if (done.length) continue;
      const file = path.join(__dirname, "../../database/migrations", name);
      if (name.endsWith(".js")) await require(file)(db);
      else {
        const sql = await fs.readFile(file, "utf8");
        for (const statement of sql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean))
          await db.query(statement);
      }
      await db.execute("INSERT INTO chp_schema_migrations(name) VALUES (?)", [
        name,
      ]);
      console.log("Applied migration", name);
    }
  } finally {
    if (locked)
      await db
        .query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':chp_migrate'))")
        .catch(() => {});
    db.release();
  }
}
if (require.main === module) {
  const pool = createPool();
  migrate(pool)
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
module.exports = { migrate, migrations };
