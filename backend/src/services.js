"use strict";
const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const random = () => crypto.randomBytes(32).toString("hex");
async function notify(db, userId, message) {
  await db.execute(
    "INSERT INTO chp_notifications (user_id,message) VALUES (?,?)",
    [userId, message],
  );
}
async function audit(db, actor, action, entity, entityId) {
  await db.execute(
    "INSERT INTO chp_audit_log (actor_id,action,entity,entity_id) VALUES (?,?,?,?)",
    [actor, action, entity, entityId],
  );
}
async function participants(db, eventId, message) {
  await db.execute(
    "INSERT INTO chp_notifications (user_id,message) SELECT volunteer_id,? FROM chp_event_participants WHERE event_id=?",
    [message, eventId],
  );
}
async function accountMail(db, user, purpose, config) {
  const token = random();
  await db.execute(
    "DELETE FROM chp_account_tokens WHERE user_id=? AND purpose=?",
    [user.id, purpose],
  );
  await db.execute(
    "INSERT INTO chp_account_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))",
    [hash(token), user.id, purpose],
  );
  const url = config.baseUrl + "/#" + purpose + "?token=" + token;
  await db.execute(
    "INSERT INTO chp_mail_outbox (recipient,subject,body) VALUES (?,?,?)",
    [
      user.email,
      purpose === "verify"
        ? "Verify your Community Help email"
        : "Reset your Community Help password",
      "Open this link within 30 minutes: " +
        url +
        "\nIf you did not request this, ignore this message.",
    ],
  );
}
function publicEligibility(alias = "e") {
  return (
    alias +
    ".status='approved' AND " +
    alias +
    ".lifecycle='scheduled' AND u.status='approved' AND u.disabled=0 AND (" +
    alias +
    ".event_date>? OR (" +
    alias +
    ".event_date=? AND " +
    alias +
    ".start_time>?))"
  );
}
module.exports = {
  hash,
  random,
  notify,
  audit,
  participants,
  accountMail,
  publicEligibility,
};
