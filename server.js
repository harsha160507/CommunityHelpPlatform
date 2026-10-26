
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { pool, testConnection } = require("./db");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const ngoRoutes = require("./routes/ngos");
const eventRoutes = require("./routes/events");
const volunteerRoutes = require("./routes/volunteers");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Community Help Platform API is running."
  });
});

// Authentication routes
app.use("/api/auth", authRoutes);

// Admin routes
app.use("/api/admin", adminRoutes);

// NGO routes
app.use("/api/ngos", ngoRoutes);

// Event routes
app.use("/api/events", eventRoutes);

// Volunteer routes
app.use("/api/volunteers", volunteerRoutes);

// Create new project tables without deleting existing tables.
async function createTables() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS chp_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'ngo', 'volunteer') NOT NULL,
      phone VARCHAR(30),
      location VARCHAR(200),
      interest VARCHAR(255),
      description TEXT,
      status ENUM('pending', 'approved', 'rejected')
        NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS chp_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ngo_id INT NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL,
      event_date DATE NOT NULL,
      location VARCHAR(255) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      capacity INT NOT NULL DEFAULT 1,
      status ENUM('pending', 'approved', 'rejected')
        NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_chp_event_ngo
        FOREIGN KEY (ngo_id) REFERENCES chp_users(id)
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS chp_event_participants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_id INT NOT NULL,
      volunteer_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_chp_participation (event_id, volunteer_id),
      CONSTRAINT fk_chp_participant_event
        FOREIGN KEY (event_id) REFERENCES chp_events(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_chp_participant_volunteer
        FOREIGN KEY (volunteer_id) REFERENCES chp_users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log("Community Help Platform tables are ready.");
}

// Create a default admin account if it doesn't already exist.
async function createAdmin() {
  const email = (
    process.env.ADMIN_EMAIL || "admin@communityhelp.local"
  ).trim().toLowerCase();

  const password = process.env.ADMIN_PASSWORD || "Admin123!";

  const [existing] = await pool.execute(
    "SELECT id FROM chp_users WHERE email = ? LIMIT 1",
    [email]
  );

  if (existing.length > 0) {
    console.log("Admin account already exists.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await pool.execute(
    `INSERT INTO chp_users
      (name, email, password_hash, role, status)
     VALUES (?, ?, ?, 'admin', 'approved')`,
    ["Platform Administrator", email, passwordHash]
  );

  console.log("Default admin account created.");
}

async function startServer() {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing from your .env file.");
    }

    await testConnection();
    await createTables();
    await createAdmin();

    const PORT = Number(process.env.PORT) || 3000;

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log("API is ready.");
    });
  } catch (error) {
    console.error("Could not start the server:", error.message);
    process.exit(1);
  }
}

startServer();
