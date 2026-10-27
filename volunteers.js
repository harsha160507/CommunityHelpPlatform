
const express = require("express");
const { pool } = require("../db");
const {
  authenticateToken,
  allowRoles
} = require("../middleware");

const router = express.Router();

// ALL ROUTES REQUIRE A LOGGED-IN VOLUNTEER
router.use(authenticateToken, allowRoles("volunteer"));

// JOIN AN APPROVED EVENT
router.post("/events/:id/join", async (req, res) => {
  let connection;

  try {
    const eventId = Number(req.params.id);

    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({
        message: "Invalid event ID."
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Lock the event row to help prevent capacity overbooking.
    const [events] = await connection.execute(
      `SELECT id, capacity, event_date, status
       FROM chp_events
       WHERE id = ?
       FOR UPDATE`,
      [eventId]
    );

    if (events.length === 0 || events[0].status !== "approved") {
      await connection.rollback();

      return res.status(404).json({
        message: "This event is unavailable or has not been approved."
      });
    }

    const event = events[0];

    const [existing] = await connection.execute(
      `SELECT id
       FROM chp_event_participants
       WHERE event_id = ? AND volunteer_id = ?
       LIMIT 1`,
      [eventId, req.user.id]
    );

    if (existing.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        message: "You have already registered for this event."
      });
    }

    if (new Date(event.event_date) < new Date(new Date().toDateString())) {
      await connection.rollback();

      return res.status(400).json({
        message: "You cannot register for a past event."
      });
    }

    const [counts] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM chp_event_participants
       WHERE event_id = ?`,
      [eventId]
    );

    if (Number(counts[0].total) >= Number(event.capacity)) {
      await connection.rollback();

      return res.status(409).json({
        message: "Sorry, this event has reached its volunteer capacity."
      });
    }

    await connection.execute(
      `INSERT INTO chp_event_participants
       (event_id, volunteer_id)
       VALUES (?, ?)`,
      [eventId, req.user.id]
    );

    await connection.commit();

    res.status(201).json({
      message: "Successfully registered for the event!"
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        // Preserve the original error.
      }
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "You have already registered for this event."
      });
    }

    console.error("Join event error:", error.message);

    res.status(500).json({
      message: "Could not register for this event. Please try again."
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// VIEW EVENTS JOINED BY THE LOGGED-IN VOLUNTEER
router.get("/my-events", async (req, res) => {
  try {
    const [events] = await pool.execute(
      `SELECT e.id, e.title, e.event_date,
              e.start_time, e.end_time, e.location,
              u.name AS ngo_name
       FROM chp_event_participants p
       JOIN chp_events e ON e.id = p.event_id
       JOIN chp_users u ON u.id = e.ngo_id
       WHERE p.volunteer_id = ?
       ORDER BY e.event_date ASC, e.start_time ASC`,
      [req.user.id]
    );

    res.json({ events });
  } catch (error) {
    console.error("Joined events error:", error.message);

    res.status(500).json({
      message: "Could not load your registered events."
    });
  }
});

module.exports = router;
