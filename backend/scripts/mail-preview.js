"use strict";
const { createPool } = require("../src/db"),
  { configuration } = require("../src/config");
async function main() {
  const config = configuration();
  if (!config.preview)
    throw new Error(
      "Mail preview is allowed only in development with DEV_MAIL_PREVIEW=true.",
    );
  const pool = createPool();
  try {
    const [messages] = await pool.query(
      "SELECT recipient,subject,body,created_at FROM chp_mail_outbox WHERE sent_at IS NULL AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 MINUTE) ORDER BY id DESC LIMIT 20",
    );
    for (const m of messages)
      console.log("\n" + m.recipient + "\n" + m.subject + "\n" + m.body);
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
