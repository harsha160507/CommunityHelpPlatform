"use strict";
const express = require("express"),
  bcrypt = require("bcryptjs");
const { transaction } = require("../db");
const v = require("../validation");
const { wrap } = require("../middleware");
const {
  hash,
  random,
  notify,
  audit,
  participants,
  accountMail,
} = require("../services");
module.exports = function ({
  pool,
  config,
  auth,
  authLimit,
  mailLimit,
  registerLimit,
}) {
  const router = express.Router();
  router.post(
    "/register",
    registerLimit,
    wrap(async (req, res) => {
      if (!["ngo", "volunteer"].includes(req.body.role))
        throw new v.HttpError(400, "Choose NGO or volunteer.");
      const role = req.body.role,
        p = v.profile(req.body, role),
        email = v.email(req.body.email),
        password = v.password(req.body.password);
      const digest = await bcrypt.hash(password, 12);
      await transaction(pool, async (db) => {
        const [result] = await db.execute(
          "INSERT INTO chp_users(name,email,password_hash,role,phone,location,interest,description,status) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            p.name,
            email,
            digest,
            role,
            p.phone,
            p.location,
            p.interest,
            p.description,
            role === "ngo" ? "pending" : "approved",
          ],
        );
        await accountMail(db, { id: result.insertId, email }, "verify", config);
        await notify(
          db,
          result.insertId,
          "Account created. Verify your email before signing in.",
        );
      });
      res.status(201).json({
        message:
          "Account created. Check your email to verify your address before signing in.",
      });
    }),
  );
  router.post(
    "/login",
    authLimit,
    wrap(async (req, res) => {
      const email = v.email(req.body.email);
      if (
        typeof req.body.password !== "string" ||
        Buffer.byteLength(req.body.password) > 72
      )
        throw new v.HttpError(400, "Enter a valid password.");
      const [rows] = await pool.execute(
        "SELECT id,email,password_hash,disabled,email_verified FROM chp_users WHERE email=?",
        [email],
      );
      // A dummy hash keeps unknown-account attempts on the same expensive password path.
      const digest =
        rows[0]?.password_hash ||
        "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxLKvi8hYtR5IGvZLsQTfOSmFDW";
      const matches = await bcrypt.compare(req.body.password, digest);
      if (!rows.length || !matches || rows[0].disabled)
        throw new v.HttpError(401, "Invalid email or password.");
      if (!rows[0].email_verified)
        throw new v.HttpError(
          403,
          "Verify your email before logging in. Use Resend verification if needed.",
        );
      const token = random();
      await transaction(pool, async (db) => {
        const [users] = await db.execute(
          "SELECT password_hash,disabled,email_verified FROM chp_users WHERE id=? FOR UPDATE",
          [rows[0].id],
        );
        if (
          users[0].password_hash !== digest ||
          users[0].disabled ||
          !users[0].email_verified
        )
          throw new v.HttpError(401, "Account changed. Please try again.");
        await db.execute(
          "INSERT INTO chp_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR))",
          [hash(token), rows[0].id],
        );
      });
      res.json({ token, message: "Signed in." });
    }),
  );
  for (const [path, purpose] of [
    ["/request-verification", "verify"],
    ["/forgot-password", "reset"],
  ]) {
    router.post(
      path,
      mailLimit,
      wrap(async (req, res) => {
        const email = v.email(req.body.email);
        await transaction(pool, async (db) => {
          const [rows] = await db.execute(
            "SELECT id,email,email_verified,disabled FROM chp_users WHERE email=? FOR UPDATE",
            [email],
          );
          const u = rows[0];
          if (u && !u.disabled && (purpose !== "verify" || !u.email_verified))
            await accountMail(db, u, purpose, config);
        });
        res.json({
          message:
            "If the account is eligible, an email with a 30-minute link will arrive shortly.",
        });
      }),
    );
  }
  for (const purpose of ["verify", "reset"])
    router.post(
      "/" + purpose,
      mailLimit,
      wrap(async (req, res) => {
        if (
          typeof req.body.token !== "string" ||
          !/^[a-f0-9]{64}$/.test(req.body.token)
        )
          throw new v.HttpError(400, "Invalid or expired link.");
        const digest =
          purpose === "reset"
            ? await bcrypt.hash(v.password(req.body.password), 12)
            : null;
        await transaction(pool, async (db) => {
          // Lock the user before its token to match the account/session mutation order.
          const [candidate] = await db.execute(
            "SELECT user_id FROM chp_account_tokens WHERE token_hash=? AND purpose=?",
            [hash(req.body.token), purpose],
          );
          if (!candidate.length)
            throw new v.HttpError(400, "Invalid or expired link.");
          const [users] = await db.execute(
            "SELECT id,disabled FROM chp_users WHERE id=? FOR UPDATE",
            [candidate[0].user_id],
          );
          const [tokens] = await db.execute(
            "SELECT user_id FROM chp_account_tokens WHERE token_hash=? AND purpose=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE",
            [hash(req.body.token), purpose],
          );
          if (!tokens.length || !users.length || users[0].disabled)
            throw new v.HttpError(400, "Invalid or expired link.");
          const id = users[0].id;
          if (purpose === "verify")
            await db.execute(
              "UPDATE chp_users SET email_verified=1,version=version+1 WHERE id=?",
              [id],
            );
          else {
            await db.execute(
              "UPDATE chp_users SET password_hash=?,email_verified=1,version=version+1 WHERE id=?",
              [digest, id],
            );
            await db.execute("DELETE FROM chp_sessions WHERE user_id=?", [id]);
          }
          await db.execute("DELETE FROM chp_account_tokens WHERE user_id=?", [
            id,
          ]);
          await notify(
            db,
            id,
            purpose === "verify"
              ? "Email address verified."
              : "Password reset. Existing sessions were signed out.",
          );
        });
        res.json({
          message:
            purpose === "verify"
              ? "Email verified. You can log in."
              : "Password reset. Log in with your new password.",
        });
      }),
    );
  router.get(
    "/me",
    auth,
    wrap(async (req, res) => res.json({ user: req.user })),
  );
  router.post(
    "/logout",
    auth,
    wrap(async (req, res) => {
      await pool.execute("DELETE FROM chp_sessions WHERE token_hash=?", [
        req.sessionHash,
      ]);
      res.json({ message: "Signed out." });
    }),
  );
  router.put(
    "/profile",
    auth,
    wrap(async (req, res) => {
      const p = v.profile(req.body, req.user.role),
        expected = v.version(req.body.version);
      await transaction(pool, async (db) => {
        const [users] = await db.execute(
          "SELECT version FROM chp_users WHERE id=? FOR UPDATE",
          [req.user.id],
        );
        if (users[0].version !== expected)
          throw new v.HttpError(409, "Profile changed. Refresh and try again.");
        await db.execute(
          "UPDATE chp_users SET name=?,phone=?,location=?,interest=?,description=?,version=version+1,status=IF(role='ngo','pending',status),rejection_reason=NULL WHERE id=?",
          [p.name, p.phone, p.location, p.interest, p.description, req.user.id],
        );
        if (req.user.role === "ngo") {
          const [events] = await db.execute(
            "SELECT id,title FROM chp_events WHERE ngo_id=? AND lifecycle='scheduled' FOR UPDATE",
            [req.user.id],
          );
          for (const e of events)
            await participants(
              db,
              e.id,
              "Organizer profile resubmitted for review. Event temporarily unavailable: " +
                e.title,
            );
        }
        await audit(db, req.user.id, "profile_updated", "user", req.user.id);
      });
      res.json({
        message:
          req.user.role === "ngo"
            ? "Profile submitted for administrator review. Your events are hidden until approved."
            : "Profile saved.",
      });
    }),
  );
  router.post(
    "/change-password",
    auth,
    authLimit,
    wrap(async (req, res) => {
      const digest = await bcrypt.hash(v.password(req.body.password), 12);
      await transaction(pool, async (db) => {
        const [users] = await db.execute(
          "SELECT password_hash FROM chp_users WHERE id=? FOR UPDATE",
          [req.user.id],
        );
        if (
          typeof req.body.currentPassword !== "string" ||
          !(await bcrypt.compare(
            req.body.currentPassword,
            users[0].password_hash,
          ))
        )
          throw new v.HttpError(400, "Current password is incorrect.");
        await db.execute("UPDATE chp_users SET password_hash=? WHERE id=?", [
          digest,
          req.user.id,
        ]);
        await db.execute("DELETE FROM chp_sessions WHERE user_id=?", [
          req.user.id,
        ]);
        await db.execute("DELETE FROM chp_account_tokens WHERE user_id=?", [
          req.user.id,
        ]);
        await notify(
          db,
          req.user.id,
          "Password changed. All sessions were signed out.",
        );
      });
      res.json({ message: "Password changed. Log in again." });
    }),
  );
  router.delete(
    "/account",
    auth,
    authLimit,
    wrap(async (req, res) => {
      if (req.user.role === "admin")
        throw new v.HttpError(
          403,
          "Administrator deletion is managed by the repository owner.",
        );
      await transaction(pool, async (db) => {
        const [users] = await db.execute(
          "SELECT password_hash FROM chp_users WHERE id=? FOR UPDATE",
          [req.user.id],
        );
        if (
          typeof req.body.password !== "string" ||
          !(await bcrypt.compare(req.body.password, users[0].password_hash))
        )
          throw new v.HttpError(400, "Password is incorrect.");
        const [events] = await db.execute(
          "SELECT id,title FROM chp_events WHERE ngo_id=? AND lifecycle='scheduled' FOR UPDATE",
          [req.user.id],
        );
        for (const e of events)
          await participants(
            db,
            e.id,
            "Organizer deleted their account. Event cancelled: " + e.title,
          );
        await db.execute(
          "UPDATE chp_events SET lifecycle='cancelled',version=version+1 WHERE ngo_id=? AND lifecycle='scheduled'",
          [req.user.id],
        );
        await db.execute(
          "DELETE FROM chp_event_participants WHERE volunteer_id=?",
          [req.user.id],
        );
        await db.execute("DELETE FROM chp_sessions WHERE user_id=?", [
          req.user.id,
        ]);
        await db.execute("DELETE FROM chp_account_tokens WHERE user_id=?", [
          req.user.id,
        ]);
        await db.execute("DELETE FROM chp_notifications WHERE user_id=?", [
          req.user.id,
        ]);
        await db.execute("DELETE FROM chp_mail_outbox WHERE recipient=?", [
          req.user.email,
        ]);
        await db.execute(
          "UPDATE chp_users SET name='Deleted account',email=?,password_hash=?,phone=NULL,location=NULL,interest=NULL,description=NULL,disabled=1,version=version+1 WHERE id=?",
          [
            "deleted+" +
              req.user.id +
              "+" +
              random().slice(0, 12) +
              "@invalid.local",
            random(),
            req.user.id,
          ],
        );
        await audit(db, req.user.id, "account_deleted", "user", req.user.id);
      });
      res.json({
        message:
          "Account deleted. Identity fields were removed; historical event records are retained.",
      });
    }),
  );
  return router;
};
