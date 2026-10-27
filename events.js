
const express = require("express");
const { pool } = require("../db");
const {
  authenticateToken,
  allowRoles
} = require("../middleware");

const router = express.Router();

// DASHBOARD STATISTICS
router.get("/stats", async (req, res) => {
  try {
    const [[volunteerResult]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM chp_users
       WHERE role = 'volunteer'`
    );

    const [[ngoResult]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM chp_users
       WHERE role = 'ngo' AND status = 'approved'`
    );

    const [[eventResult]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM chp_events
       WHERE status = 'approved'`
    );

    let myParticipations = 0;

    if (req.headers.authorization) {
      try {
        const jwt = require("jsonwebtoken");
        const token = req.headers.authorization.split(" ")[1];
        const user = jwt.verify(token, process.env.JWT_SECRET);

        if (user.role === "volunteer") {
          const [[participationResult]] = await pool.execute(
            `SELECT COUNT(*) AS total
             FROM chp_event_participants
             WHERE volunteer_id = ?`,
            [user.id]
          );

          myParticipations = participationResult.total;
        }
      } catch (error) {
        // Public dashboard statistics can still be displayed.
      }
    }

    res.json({
      volunteers: volunteerResult.total,
      ngos: ngoResult.total,
      events: eventResult.total,
      myParticipations
    });
  } catch (error) {
    console.error("Statistics error:", error.message);

    res.status(500).json({
      message: "Could not load dashboard statistics."
    });
  }
});

// CREATE AN EVENT — APPROVED NGOS ONLY
router.post("/", authenticateToken, allowRoles("ngo"), async (req, res) => {
  try {
    const {
      title,
      description,
      event_date,
      location,
      start_time,
      end_time,
      capacity
    } = req.body;

    if (
      !title ||
      !description ||
      !event_date ||
      !location ||
      !start_time ||
      !end_time ||
      capacity === undefined ||
      capacity === null
    ) {
      return res.status(400).json({
        message: "Please fill in all event fields."
      });
    }

    const parsedCapacity = Number(capacity);

    if (
      !Number.isInteger(parsedCapacity) ||
      parsedCapacity < 1 ||
      parsedCapacity > 100000
    ) {
      return res.status(400).json({
        message: "Volunteer capacity must be a positive whole number."
      });
    }

    if (String(end_time) <= String(start_time)) {
      return res.status(400).json({
        message: "End time must be later than start time."
      });
    }

    // Confirm that this NGO has been approved by the admin.
    const [ngos] = await pool.execute(
      `SELECT status
       FROM chp_users
       WHERE id = ? AND role = 'ngo'
       LIMIT 1`,
      [req.user.id]
    );

    if (ngos.length === 0 || ngos[0].status !== "approved") {
      return res.status(403).json({
        message: "Your NGO must be approved before creating events."
      });
    }

    await pool.execute(
      `INSERT INTO chp_events
       (ngo_id, title, description, event_date, location,
        start_time, end_time, capacity, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        req.user.id,
        String(title).trim(),
        String(description).trim(),
        event_date,
        String(location).trim(),
        start_time,
        end_time,
        parsedCapacity
      ]
    );

    res.status(201).json({
      message: "Event submitted successfully. Please wait for admin approval."
    });
  } catch (error) {
    console.error("Create event error:", error.message);

    res.status(500).json({
      message: "Could not create the event. Check the date and time."
    });
  }
});

// LIST APPROVED EVENTS — PUBLIC/VOLUNTEER DASHBOARD
router.get("/", async (req, res) => {
  try {
    const [events] = await pool.execute(
      `SELECT e.id, e.title, e.description, e.event_date,
              e.location, e.start_time, e.end_time, e.capacity,
              u.name AS ngo_name,
              (SELECT COUNT(*)
               FROM chp_event_participants p
               WHERE p.event_id = e.id) AS participant_count
       FROM chp_events e
       JOIN chp_users u ON u.id = e.ngo_id
       WHERE e.status = 'approved'
         AND u.status = 'approved'
       ORDER BY e.event_date ASC, e.start_time ASC`
    );

    res.json({ events });
  } catch (error) {
    console.error("Event listing error:", error.message);

    res.status(500).json({
      message: "Could not load events."
    });
  }
});

// GET EVENTS CREATED BY THE LOGGED-IN NGO
router.get("/mine", authenticateToken, allowRoles("ngo"), async (req, res) => {
  try {
    const [events] = await pool.execute(
      `SELECT e.id, e.title, e.description, e.event_date,
              e.location, e.start_time, e.end_time, e.capacity,
              e.status,
              (SELECT COUNT(*)
               FROM chp_event_participants p
               WHERE p.event_id = e.id) AS participant_count
       FROM chp_events e
       WHERE e.ngo_id = ?
       ORDER BY e.created_at DESC`,
      [req.user.id]
    );

    res.json({ events });
  } catch (error) {
    console.error("NGO events error:", error.message);

    res.status(500).json({
      message: "Could not load your events."
    });
  }
});

module.exports = router;
