"use strict";
const express = require("express");
const { transaction } = require("../db"),
  v = require("../validation"),
  { wrap, roles } = require("../middleware");
const { collection } = require("../pagination");
const {
  notify,
  audit,
  participants,
  publicEligibility,
} = require("../services");
const fields =
  "e.*,u.name AS ngo_name,u.status AS ngo_status,u.disabled AS ngo_disabled,(SELECT COUNT(*) FROM chp_event_participants p WHERE p.event_id=e.id) AS participant_count";
async function lockEvent(db, eventId, owner) {
  const [refs] = await db.execute("SELECT ngo_id FROM chp_events WHERE id=?", [
    eventId,
  ]);
  if (!refs.length) throw new v.HttpError(404, "Event not found.");
  const [ngos] = await db.execute(
    "SELECT id,status,disabled FROM chp_users WHERE id=? FOR UPDATE",
    [refs[0].ngo_id],
  );
  const [events] = await db.execute(
    "SELECT * FROM chp_events WHERE id=? FOR UPDATE",
    [eventId],
  );
  if (!events.length || (owner && events[0].ngo_id !== owner))
    throw new v.HttpError(404, "Event not found.");
  return { event: events[0], ngo: ngos[0] };
}
function current(event, expected) {
  if (event.version !== v.version(expected))
    throw new v.HttpError(409, "Event changed. Refresh and try again.");
}
module.exports = function ({ pool, config, auth }) {
  const router = express.Router();
  router.get(
    "/",
    wrap(async (req, res) => {
      const [date, time] = v.cutoff(config.timezone);
      const filter = publicEligibility();
      await collection(pool, req, res, {
        select:
          "SELECT " +
          fields +
          " FROM chp_events e JOIN chp_users u ON u.id=e.ngo_id WHERE " +
          filter +
          " ORDER BY e.event_date,e.start_time,e.id",
        count:
          "SELECT COUNT(*) AS total FROM chp_events e JOIN chp_users u ON u.id=e.ngo_id WHERE " +
          filter,
        params: [date, date, time],
        key: "events",
      });
    }),
  );
  router.get(
    "/mine",
    auth,
    roles("ngo"),
    wrap(async (req, res) => {
      await collection(pool, req, res, {
        select:
          "SELECT " +
          fields +
          " FROM chp_events e JOIN chp_users u ON u.id=e.ngo_id WHERE e.ngo_id=? ORDER BY e.created_at DESC,e.id DESC",
        count: "SELECT COUNT(*) AS total FROM chp_events WHERE ngo_id=?",
        params: [req.user.id],
        key: "events",
      });
    }),
  );
  router.get(
    "/:id/owner",
    auth,
    roles("ngo"),
    wrap(async (req, res) => {
      const id = v.positive(req.params.id);
      const [rows] = await pool.execute(
        "SELECT * FROM chp_events WHERE id=? AND ngo_id=?",
        [id, req.user.id],
      );
      if (!rows.length) throw new v.HttpError(404, "Event not found.");
      res.json({ event: rows[0] });
    }),
  );
  router.post(
    "/",
    auth,
    roles("ngo"),
    wrap(async (req, res) => {
      const input = v.event(req.body, config.timezone);
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(key))
        throw new v.HttpError(
          400,
          "Provide an Idempotency-Key for event submissions.",
        );
      const result = await transaction(pool, async (db) => {
        const [ngos] = await db.execute(
          "SELECT status,disabled FROM chp_users WHERE id=? FOR UPDATE",
          [req.user.id],
        );
        if (!ngos.length || ngos[0].status !== "approved" || ngos[0].disabled)
          throw new v.HttpError(
            403,
            "Your NGO must be approved before creating an event.",
          );
        const [existing] = await db.execute(
          "SELECT event_id FROM chp_event_requests WHERE user_id=? AND request_key=?",
          [req.user.id, key],
        );
        if (existing.length) return { id: existing[0].event_id, replay: true };
        const [insert] = await db.execute(
          "INSERT INTO chp_events(ngo_id,title,description,event_date,location,start_time,end_time,capacity) VALUES (?,?,?,?,?,?,?,?)",
          [
            req.user.id,
            input.title,
            input.description,
            input.event_date,
            input.location,
            input.start_time,
            input.end_time,
            input.capacity,
          ],
        );
        await db.execute(
          "INSERT INTO chp_event_requests(user_id,request_key,event_id) VALUES (?,?,?)",
          [req.user.id, key, insert.insertId],
        );
        await notify(
          db,
          req.user.id,
          "Event submitted for review: " + input.title,
        );
        await audit(
          db,
          req.user.id,
          "event_submitted",
          "event",
          insert.insertId,
        );
        return { id: insert.insertId, replay: false };
      });
      res
        .status(result.replay ? 200 : 201)
        .json({ ...result, message: "Event submitted for review." });
    }),
  );
  router.put(
    "/:id",
    auth,
    roles("ngo"),
    wrap(async (req, res) => {
      const id = v.positive(req.params.id),
        input = v.event(req.body, config.timezone);
      await transaction(pool, async (db) => {
        const { event, ngo } = await lockEvent(db, id, req.user.id);
        current(event, req.body.version);
        if (ngo.status !== "approved" || ngo.disabled)
          throw new v.HttpError(403, "Your NGO must be approved.");
        if (
          event.lifecycle !== "scheduled" ||
          !v.upcoming(event, config.timezone)
        )
          throw new v.HttpError(
            409,
            "Only future scheduled events can be edited.",
          );
        const [[count]] = await db.execute(
          "SELECT COUNT(*) AS total FROM chp_event_participants WHERE event_id=?",
          [id],
        );
        if (input.capacity < count.total)
          throw new v.HttpError(
            409,
            "Capacity cannot be below the current participant count.",
          );
        await db.execute(
          "UPDATE chp_events SET title=?,description=?,event_date=?,location=?,start_time=?,end_time=?,capacity=?,status='pending',rejection_reason=NULL,version=version+1 WHERE id=?",
          [
            input.title,
            input.description,
            input.event_date,
            input.location,
            input.start_time,
            input.end_time,
            input.capacity,
            id,
          ],
        );
        await participants(
          db,
          id,
          "Event details changed and are awaiting review: " + input.title,
        );
        await notify(
          db,
          req.user.id,
          "Event changes submitted for review: " + input.title,
        );
        await audit(db, req.user.id, "event_resubmitted", "event", id);
      });
      res.json({
        message:
          "Changes submitted for review. Registered volunteers were notified.",
      });
    }),
  );
  for (const action of ["cancel", "complete"])
    router.post(
      "/:id/" + action,
      auth,
      roles("ngo"),
      wrap(async (req, res) => {
        const id = v.positive(req.params.id);
        await transaction(pool, async (db) => {
          const { event, ngo } = await lockEvent(db, id, req.user.id);
          current(event, req.body.version);
          if (event.lifecycle !== "scheduled")
            throw new v.HttpError(409, "This event is already closed.");
          if (
            action === "complete" &&
            (ngo.status !== "approved" ||
              ngo.disabled ||
              event.status !== "approved" ||
              v.eventTime(event.event_date, event.end_time, config.timezone) >
                require("luxon").DateTime.now())
          )
            throw new v.HttpError(
              409,
              "Only an approved event that has ended can be completed.",
            );
          const state = action === "cancel" ? "cancelled" : "completed";
          await db.execute(
            "UPDATE chp_events SET lifecycle=?,version=version+1 WHERE id=?",
            [state, id],
          );
          await participants(db, id, "Event " + state + ": " + event.title);
          await notify(db, req.user.id, "Event " + state + ": " + event.title);
          await audit(db, req.user.id, "event_" + state, "event", id);
        });
        res.json({
          message:
            "Event " + (action === "cancel" ? "cancelled" : "completed") + ".",
        });
      }),
    );
  router.get(
    "/:id/participants",
    auth,
    roles("ngo"),
    wrap(async (req, res) => {
      const id = v.positive(req.params.id);
      const [owned] = await pool.execute(
        "SELECT id FROM chp_events WHERE id=? AND ngo_id=?",
        [id, req.user.id],
      );
      if (!owned.length) throw new v.HttpError(404, "Event not found.");
      await collection(pool, req, res, {
        select:
          "SELECT u.id,u.name,u.email,u.phone,p.attended,p.created_at FROM chp_event_participants p JOIN chp_users u ON u.id=p.volunteer_id WHERE p.event_id=? ORDER BY u.name,u.id",
        count:
          "SELECT COUNT(*) AS total FROM chp_event_participants WHERE event_id=?",
        params: [id],
        key: "participants",
      });
    }),
  );
  router.patch(
    "/:id/participants/:volunteerId",
    auth,
    roles("ngo"),
    wrap(async (req, res) => {
      const id = v.positive(req.params.id),
        volunteerId = v.positive(req.params.volunteerId);
      if (typeof req.body.attended !== "boolean")
        throw new v.HttpError(400, "Attendance must be true or false.");
      await transaction(pool, async (db) => {
        const { event, ngo } = await lockEvent(db, id, req.user.id);
        if (
          event.lifecycle !== "completed" ||
          ngo.status !== "approved" ||
          ngo.disabled
        )
          throw new v.HttpError(
            409,
            "Attendance can be recorded for completed events by approved NGOs.",
          );
        const [result] = await db.execute(
          "UPDATE chp_event_participants SET attended=? WHERE event_id=? AND volunteer_id=?",
          [req.body.attended ? 1 : 0, id, volunteerId],
        );
        if (!result.affectedRows)
          throw new v.HttpError(404, "Participant not found.");
        await audit(
          db,
          req.user.id,
          req.body.attended ? "attendance_marked" : "attendance_cleared",
          "event",
          id,
        );
      });
      res.json({ message: "Attendance saved." });
    }),
  );
  return router;
};
module.exports.lockEvent = lockEvent;
