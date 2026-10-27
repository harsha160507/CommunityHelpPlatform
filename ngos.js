
const express = require("express");
const { pool } = require("../db");
const {
  authenticateToken,
  allowRoles
} = require("../middleware");

const router = express.Router();

// GET THE LOGGED-IN NGO'S PROFILE AND APPROVAL STATUS
router.get("/me", authenticateToken, allowRoles("ngo"), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, email, phone, location, description,
              status, created_at
       FROM chp_users
       WHERE id = ? AND role = 'ngo'
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "NGO account not found."
      });
    }

    res.json({ ngo: rows[0] });
  } catch (error) {
    console.error("NGO profile error:", error.message);

    res.status(500).json({
      message: "Could not load NGO profile."
    });
  }
});

// PUBLIC DIRECTORY OF APPROVED NGOS
router.get("/", async (req, res) => {
  try {
    const [ngos] = await pool.execute(
      `SELECT id, name, location, description
       FROM chp_users
       WHERE role = 'ngo' AND status = 'approved'
       ORDER BY name ASC`
    );

    res.json({ ngos });
  } catch (error) {
    console.error("NGO directory error:", error.message);

    res.status(500).json({
      message: "Could not load the NGO directory."
    });
  }
});

module.exports = router;
