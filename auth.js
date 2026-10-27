
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { authenticateToken } = require("../middleware");

const router = express.Router();

// REGISTER NGO OR VOLUNTEER
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      phone,
      location,
      interest,
      description
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "Please fill in all required fields."
      });
    }

    if (!["ngo", "volunteer"].includes(role)) {
      return res.status(400).json({
        message: "Only NGO and volunteer registration is allowed."
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        message: "Password must contain at least 6 characters."
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const [existingUsers] = await pool.execute(
      "SELECT id FROM chp_users WHERE email = ?",
      [cleanEmail]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        message: "This email is already registered. Please log in."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // NGOs require admin approval; volunteers are approved immediately.
    const status = role === "ngo" ? "pending" : "approved";

    await pool.execute(
      `INSERT INTO chp_users
      (name, email, password_hash, role, phone, location,
       interest, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        cleanEmail,
        passwordHash,
        role,
        phone || null,
        location || null,
        interest || null,
        description || null,
        status
      ]
    );

    const message =
      role === "ngo"
        ? "NGO registration submitted successfully. Please wait for admin approval."
        : "Volunteer registration successful. You can now log in.";

    return res.status(201).json({ message });
  } catch (error) {
    console.error("Registration error:", error.message);

    return res.status(500).json({
      message: "Registration failed. Please try again."
    });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Please enter your email and password."
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const [users] = await pool.execute(
      `SELECT id, name, email, password_hash, role, status
       FROM chp_users
       WHERE email = ?
       LIMIT 1`,
      [cleanEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const user = users[0];

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    if (user.role === "ngo" && user.status === "rejected") {
      return res.status(403).json({
        message: "Your NGO registration was rejected. Please contact the administrator."
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Login failed. Please try again."
    });
  }
});

// GET CURRENTLY LOGGED-IN USER
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, name, email, role, status, phone, location,
              interest, description
       FROM chp_users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        message: "User account not found."
      });
    }

    return res.json({
      user: users[0]
    });
  } catch (error) {
    console.error("User profile error:", error.message);

    return res.status(500).json({
      message: "Could not load your profile."
    });
  }
});

module.exports = router;
