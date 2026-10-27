"use strict";
const express = require("express"),
  v = require("../validation");
const { transaction } = require("../db"),
  { wrap, roles } = require("../middleware"),
  { collection } = require("../pagination");
const { notify, audit } = require("../services"),
  { lockEvent } = require("./events");
module.exports = function ({ pool, config, auth }) {
  const router = express.Router();
  router.use(auth, roles("volunteer"));
  router.get(
    "/my-events",
    wrap(async (req, res) =>
      collection(pool, req, res, {
        select:
          "SELECT e.*,u.name AS ngo_name,u.status AS ngo_status,u.disabled AS ngo_disabled,p.attended FROM chp_event_participants p JOIN chp_events e ON e.id=p.event_id JOIN chp_users u ON u.id=e.ngo_id WHERE p.volunteer_id=? ORDER BY e.event_date DESC,e.id DESC",
        count:
          "SELECT COUNT(*) AS total FROM chp_event_participants WHERE volunteer_id=?",
        params: [req.user.id],
        key: "events",
      }),
    ),
  );
  router.post(
    "/events/:id/join",
    wrap(async (req, res) => {
      const id = v.positive(req.params.id);
      await transaction(pool, async (db) => {
        const { event, ngo } = await lockEvent(db, id);
        const [users] = await db.execute(
          "SELECT disabled FROM chp_users WHERE id=? FOR UPDATE",
          [req.user.id],
        );
        if (!users.length || users[0].disabled)
          throw new v.HttpError(401, "Account unavailable.");
        if (
          event.status !== "approved" ||
          event.lifecycle !== "scheduled" ||
          ngo.status !== "approved" ||
          ngo.disabled
        )
          throw new v.HttpError(409, "This event is unavailable.");
        if (!v.upcoming(event, config.timezone))
          throw new v.HttpError(
            409,
            "Registration closes when the event starts.",
          );
        const [existing] = await db.execute(
          "SELECT id FROM chp_event_participants WHERE event_id=? AND volunteer_id=?",
          [id, req.user.id],
        );
        if (existing.length)
          throw new v.HttpError(409, "You have already registered.");
        const [[count]] = await db.execute(
          "SELECT COUNT(*) AS total FROM chp_event_participants WHERE event_id=?",
          [id],
        );
        if (count.total >= event.capacity)
          throw new v.HttpError(409, "This event is full.");
        await db.execute(
          "INSERT INTO chp_event_participants(event_id,volunteer_id) VALUES (?,?)",
          [id, req.user.id],
        );
        await notify(db, req.user.id, "Registered for: " + event.title);
        await audit(db, req.user.id, "event_joined", "event", id);
      });
      res.status(201).json({ message: "You are registered." });
    }),
  );
  router.delete(
    "/events/:id/join",
    wrap(async (req, res) => {
      const id = v.positive(req.params.id);
      await transaction(pool, async (db) => {
        const { event } = await lockEvent(db, id);
        // Closed or unavailable events may still be withdrawn from; completed attendance is retained.
        if (event.lifecycle === "completed")
          throw new v.HttpError(
            409,
            "Completed attendance records cannot be withdrawn.",
          );
        const [result] = await db.execute(
          "DELETE FROM chp_event_participants WHERE event_id=? AND volunteer_id=?",
          [id, req.user.id],
        );
        if (!result.affectedRows)
          throw new v.HttpError(404, "Registration not found.");
        await notify(db, req.user.id, "Registration withdrawn: " + event.title);
        await audit(db, req.user.id, "event_withdrawn", "event", id);
      });
      res.json({ message: "Registration withdrawn." });
    }),
  );
  return router;
};
