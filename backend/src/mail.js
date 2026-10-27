"use strict";
const nodemailer = require("nodemailer");
const { transaction } = require("./db");
function mailWorker(pool, config, env = process.env, logger = console) {
  if (config.preview) return { tick: async () => {}, close: () => {} };
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "true",
    requireTLS: env.SMTP_SECURE !== "true",
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  let busy = false;
  return {
    async tick() {
      if (busy) return;
      busy = true;
      try {
        await transaction(pool, async (db) => {
          const [rows] = await db.query(
            "SELECT * FROM chp_mail_outbox WHERE sent_at IS NULL AND attempts<5 AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 MINUTE) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
          );
          if (!rows.length) return;
          const mail = rows[0];
          try {
            await transport.sendMail({
              from: env.MAIL_FROM,
              to: mail.recipient,
              subject: mail.subject,
              text: mail.body,
            });
            await db.execute(
              "UPDATE chp_mail_outbox SET body='',sent_at=UTC_TIMESTAMP(),attempts=attempts+1 WHERE id=?",
              [mail.id],
            );
          } catch {
            await db.execute(
              "UPDATE chp_mail_outbox SET attempts=attempts+1 WHERE id=?",
              [mail.id],
            );
            logger.error(
              JSON.stringify({
                event: "mail_delivery_failed",
                mailId: mail.id,
              }),
            );
          }
        });
        await pool.execute(
          "DELETE FROM chp_account_tokens WHERE expires_at<=UTC_TIMESTAMP()",
        );
        await pool.execute(
          "DELETE FROM chp_sessions WHERE expires_at<=UTC_TIMESTAMP()",
        );
        await pool.execute(
          "DELETE FROM chp_mail_outbox WHERE created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)",
        );
      } catch (error) {
        logger.error(
          JSON.stringify({
            event: "mail_worker_failed",
            code: error.code || "INTERNAL_ERROR",
          }),
        );
      } finally {
        busy = false;
      }
    },
    close() {
      transport.close();
    },
  };
}
module.exports = { mailWorker };
