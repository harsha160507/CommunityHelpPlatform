"use strict";
const express = require("express"),
  v = require("../validation");
const { transaction } = require("../db"),
  { wrap, roles } = require("../middleware"),
  { collection } = require("../pagination");
const { notify, audit, participants } = require("../services"),
  { lockEvent } = require("./events");
module.exports = function ({ pool, config, auth }) {
  const router = express.Router();
  router.use(auth, roles("admin"));
  for (const role of ["ngo", "volunteer"])
    router.get(
      "/" + (role === "ngo" ? "ngos" : "volunteers"),
      wrap(async (req, res) => {
        let where = "role=? AND email NOT LIKE 'deleted+%@invalid.local'",
          params = [role];
        if (req.query.status) {
          if (!["pending", "approved", "rejected"].includes(req.query.status))
            throw new v.HttpError(400, "Invalid status.");
          where += " AND status=?";
          params.push(req.query.status);
        }
        await collection(pool, req, res, {
          select:
            "SELECT id,name,email,phone,location,interest,description,status,email_verified,disabled,version,rejection_reason,created_at FROM chp_users WHERE " +
            where +
            " ORDER BY created_at DESC,id DESC",
          count: "SELECT COUNT(*) AS total FROM chp_users WHERE " + where,
          params,
          key: role === "ngo" ? "ngos" : "volunteers",
        });
      }),
    );
  router.get(
    "/events",
    wrap(async (req, res) => {
      let where = "1=1",
        params = [];
      if (req.query.status) {
        if (!["pending", "approved", "rejected"].includes(req.query.status))
          throw new v.HttpError(400, "Invalid status.");
        where += " AND e.status=?";
        params.push(req.query.status);
      }
      await collection(pool, req, res, {
        select:
          "SELECT e.*,u.name AS ngo_name,u.status AS ngo_status,u.disabled AS ngo_disabled,(SELECT COUNT(*) FROM chp_event_participants p WHERE p.event_id=e.id) AS participant_count FROM chp_events e JOIN chp_users u ON u.id=e.ngo_id WHERE " +
          where +
          " ORDER BY e.created_at DESC,e.id DESC",
        count: "SELECT COUNT(*) AS total FROM chp_events e WHERE " + where,
        params,
        key: "events",
      });
    }),
  );
  function decision(body) {
    if (!["approved", "rejected"].includes(body.status))
      throw new v.HttpError(400, "Choose approved or rejected.");
    if (!["pending", "approved", "rejected"].includes(body.expectedStatus))
      throw new v.HttpError(400, "A current expectedStatus is required.");
    return {
      status: body.status,
      version: v.version(body.version),
      reason: v.text(
        body.reason,
        "Rejection reason",
        1000,
        body.status === "rejected",
      ),
    };
  }
  router.patch(
    "/ngos/:id",
    wrap(async (req, res) => {
      const id = v.positive(req.params.id),
        d = decision(req.body);
      await transaction(pool, async (db) => {
        const [rows] = await db.execute(
          "SELECT * FROM chp_users WHERE id=? AND role='ngo' FOR UPDATE",
          [id],
        );
        if (!rows.length) throw new v.HttpError(404, "NGO not found.");
        const u = rows[0];
        if (u.version !== d.version || u.status !== req.body.expectedStatus)
          throw new v.HttpError(
            409,
            "Request changed. Refresh and review it again.",
          );
        if (d.status === "approved" && (!u.email_verified || u.disabled))
          throw new v.HttpError(
            409,
            "NGO must verify its email and have an active account first.",
          );
        await db.execute(
          "UPDATE chp_users SET status=?,rejection_reason=?,version=version+1 WHERE id=?",
          [d.status, d.status === "rejected" ? d.reason : null, id],
        );
        await notify(
          db,
          id,
          "NGO review: " + d.status + (d.reason ? ". " + d.reason : ""),
        );
        const [events] = await db.execute(
          "SELECT id,title FROM chp_events WHERE ngo_id=? AND lifecycle='scheduled' FOR UPDATE",
          [id],
        );
        for (const e of events)
          await participants(
            db,
            e.id,
            "Organizer review changed to " + d.status + ": " + e.title,
          );
        await audit(db, req.user.id, "ngo_" + d.status, "user", id);
      });
      res.json({ message: "NGO " + d.status + "." });
    }),
  );
  router.patch(
    "/events/:id",
    wrap(async (req, res) => {
      const id = v.positive(req.params.id),
        d = decision(req.body);
      await transaction(pool, async (db) => {
        const { event, ngo } = await lockEvent(db, id);
        if (
          event.version !== d.version ||
          event.status !== req.body.expectedStatus
        )
          throw new v.HttpError(
            409,
            "Request changed. Refresh and review it again.",
          );
        if (event.lifecycle !== "scheduled")
          throw new v.HttpError(409, "Closed events cannot be reviewed.");
        if (
          d.status === "approved" &&
          (ngo.status !== "approved" ||
            ngo.disabled ||
            !v.upcoming(event, config.timezone))
        )
          throw new v.HttpError(
            409,
            "Approval requires an approved organizer and a future event.",
          );
        await db.execute(
          "UPDATE chp_events SET status=?,rejection_reason=?,version=version+1 WHERE id=?",
          [d.status, d.status === "rejected" ? d.reason : null, id],
        );
        await notify(
          db,
          event.ngo_id,
          "Event review: " +
            d.status +
            " — " +
            event.title +
            (d.reason ? ". " + d.reason : ""),
        );
        await participants(
          db,
          id,
          "Event review changed to " + d.status + ": " + event.title,
        );
        await audit(db, req.user.id, "event_" + d.status, "event", id);
      });
      res.json({ message: "Event " + d.status + "." });
    }),
  );
  router.patch(
    "/volunteers/:id",
    wrap(async (req, res) => {
      const id = v.positive(req.params.id),
        expected = v.version(req.body.version);
      if (typeof req.body.disabled !== "boolean")
        throw new v.HttpError(400, "disabled must be true or false.");
      await transaction(pool, async (db) => {
        const [users] = await db.execute(
          "SELECT version FROM chp_users WHERE id=? AND role='volunteer' FOR UPDATE",
          [id],
        );
        if (!users.length) throw new v.HttpError(404, "Volunteer not found.");
        if (users[0].version !== expected)
          throw new v.HttpError(409, "Account changed. Refresh and try again.");
        await db.execute(
          "UPDATE chp_users SET disabled=?,version=version+1 WHERE id=?",
          [req.body.disabled ? 1 : 0, id],
        );
        if (req.body.disabled)
          await db.execute("DELETE FROM chp_sessions WHERE user_id=?", [id]);
        await notify(
          db,
          id,
          req.body.disabled
            ? "Administrator disabled this account."
            : "Administrator restored this account.",
        );
        await audit(
          db,
          req.user.id,
          req.body.disabled ? "volunteer_disabled" : "volunteer_restored",
          "user",
          id,
        );
      });
      res.json({ message: "Account updated." });
    }),
  );
  router.get(
    "/audit",
    wrap(async (req, res) =>
      collection(pool, req, res, {
        select:
          "SELECT a.*,u.name AS actor_name FROM chp_audit_log a LEFT JOIN chp_users u ON u.id=a.actor_id ORDER BY a.id DESC",
        count: "SELECT COUNT(*) AS total FROM chp_audit_log",
        key: "activity",
      }),
    ),
  );
  return router;
};
