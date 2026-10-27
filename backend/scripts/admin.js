"use strict";
const bcrypt = require("bcryptjs");
const { createPool, transaction } = require("../src/db");
const v = require("../src/validation");
async function setupAdmin(pool, env = process.env) {
  const email = v.email(env.ADMIN_EMAIL);
  const password = v.password(env.ADMIN_PASSWORD);
  if (/admin123|password|changeme/i.test(password))
    throw new Error("Choose a unique, strong administrator password.");
  const digest = await bcrypt.hash(password, 12);
  await transaction(pool, async (db) => {
    const [rows] = await db.execute(
      "SELECT id,role FROM chp_users WHERE email=? FOR UPDATE",
      [email],
    );
    if (rows.length && rows[0].role !== "admin")
      throw new Error(
        "That email belongs to a non-admin account. Choose another email.",
      );
    if (rows.length) {
      await db.execute(
        "UPDATE chp_users SET password_hash=?,disabled=0,email_verified=1,status='approved',version=version+1 WHERE id=?",
        [digest, rows[0].id],
      );
      await db.execute("DELETE FROM chp_sessions WHERE user_id=?", [
        rows[0].id,
      ]);
    } else
      await db.execute(
        "INSERT INTO chp_users(name,email,password_hash,role,status,email_verified) VALUES ('Platform Administrator',?,?,'admin','approved',1)",
        [email, digest],
      );
  });
}
if (require.main === module) {
  const pool = createPool();
  setupAdmin(pool)
    .then(() =>
      console.log("Administrator password set; previous sessions revoked."),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
module.exports = { setupAdmin };
