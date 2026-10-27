
const express = require("express");
const { pool } = require("../db");
const {
  authenticateToken,
  allowRoles
} = require("../middleware");

const router = express.Router();

// Every route in this file requires an admin login.
router.use(authenticateToken, allowRoles("admin"));

// VIEW PENDING NGO REGISTRATIONS
router.get("/ngos/pending", async (req, res) => {
  try {
    const [ngos] = await pool.execute(
      `SELECT id, name, email, phone, location, description,
              status, created_at
       FROM chp_users
       WHERE role = 'ngo' AND status = 'pending'
       ORDER BY created_at DESC`
    );

    res.json({ ngos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load pending NGOs." });
  }
});

// APPROVE OR REJECT AN NGO
router.patch("/ngos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid NGO ID." });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        message: "Status must be approved or rejected."
      });
    }

    const [result] = await pool.execute(
      `UPDATE chp_users
       SET status = ?
       WHERE id = ? AND role = 'ngo'`,
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "NGO not found."
      });
    }

    res.json({
      message: `NGO ${status} successfully.`,
      status
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not update NGO status." });
  }
});

// VIEW ALL NGOS
router.get("/ngos", async (req, res) => {
  try {
    const [ngos] = await pool.execute(
      `SELECT id, name, email, phone, location, description,
              status, created_at
       FROM chp_users
       WHERE role = 'ngo'
       ORDER BY created_at DESC`
    );

    res.json({ ngos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load NGOs." });
  }
});

// VIEW ALL VOLUNTEERS
router.get("/volunteers", async (req, res) => {
  try {
    const [volunteers] = await pool.execute(
      `SELECT id, name, email, phone, location, interest,
              status, created_at
       FROM chp_users
       WHERE role = 'volunteer'
       ORDER BY created_at DESC`
    );

    res.json({ volunteers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load volunteers." });
  }
});

// VIEW PENDING EVENT REQUESTS
router.get("/events/pending", async (req, res) => {
  try {
    const [events] = await pool.execute(
      `SELECT e.id, e.ngo_id, e.title, e.description,
              e.event_date, e.location, e.start_time,
              e.end_time, e.capacity, e.status, e.created_at,
              u.name AS ngo_name
       FROM chp_events e
       JOIN chp_users u ON u.id = e.ngo_id
       WHERE e.status = 'pending'
       ORDER BY e.created_at DESC`
    );

    res.json({ events });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Could not load pending events."
    });
  }
});

// APPROVE OR REJECT AN EVENT
router.patch("/events/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid event ID." });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        message: "Status must be approved or rejected."
      });
    }

    const [result] = await pool.execute(
      `UPDATE chp_events
       SET status = ?
       WHERE id = ?`,
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Event not found."
      });
    }

    res.json({
      message: `Event ${status} successfully.`,
      status
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not update event status." });
  }
});

// VIEW ALL EVENTS
router.get("/events", async (req, res) => {
  try {
    const [events] = await pool.execute(
      `SELECT e.id, e.ngo_id, e.title, e.description,
              e.event_date, e.location, e.start_time,
              e.end_time, e.capacity, e.status, e.created_at,
              u.name AS ngo_name,
              (SELECT COUNT(*)
               FROM chp_event_participants p
               WHERE p.event_id = e.id) AS participant_count
       FROM chp_events e
       JOIN chp_users u ON u.id = e.ngo_id
       ORDER BY e.created_at DESC`
    );

    res.json({ events });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load events." });
  }
});

module.exports = router;
