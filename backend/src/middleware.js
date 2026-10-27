"use strict";
const { hash } = require("./services");
const { HttpError } = require("./validation");
const wrap = (action) => (req, res, next) =>
  Promise.resolve(action(req, res, next)).catch(next);
function authentication(pool) {
  return wrap(async (req, res, next) => {
    const header = req.headers.authorization || "";
    if (!/^Bearer [a-f0-9]{64}$/.test(header))
      throw new HttpError(401, "Please log in to continue.");
    const digest = hash(header.slice(7));
    const [rows] = await pool.execute(
      "SELECT u.id,u.name,u.email,u.role,u.status,u.email_verified,u.disabled,u.version,u.phone,u.location,u.interest,u.description,u.rejection_reason FROM chp_sessions s JOIN chp_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.disabled=0 AND u.email_verified=1",
      [digest],
    );
    if (!rows.length)
      throw new HttpError(
        401,
        "Your session has expired or been revoked. Please log in.",
      );
    req.user = rows[0];
    req.sessionHash = digest;
    next();
  });
}
const roles =
  (...allowed) =>
  (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role))
      return next(
        new HttpError(403, "You do not have permission for this action."),
      );
    next();
  };
module.exports = { wrap, authentication, roles };
