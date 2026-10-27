"use strict";
module.exports = async function (db) {
  async function column(table, name, definition) {
    const [rows] = await db.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      [table, name],
    );
    if (!rows.length) {
      await db.query(
        "ALTER TABLE " + table + " ADD COLUMN " + name + " " + definition,
      );
      return true;
    }
    return false;
  }
  await column("chp_users", "email_verified", "TINYINT(1) NOT NULL DEFAULT 0");
  const newlyDisabled = await column(
    "chp_users",
    "disabled",
    "TINYINT(1) NOT NULL DEFAULT 0",
  );
  await column("chp_users", "version", "INT NOT NULL DEFAULT 1");
  await column("chp_users", "rejection_reason", "VARCHAR(1000) NULL");
  if (newlyDisabled)
    await db.execute("UPDATE chp_users SET disabled=1 WHERE role='admin'");
  await column(
    "chp_events",
    "lifecycle",
    "ENUM('scheduled','cancelled','completed') NOT NULL DEFAULT 'scheduled'",
  );
  await column("chp_events", "version", "INT NOT NULL DEFAULT 1");
  await column("chp_events", "rejection_reason", "VARCHAR(1000) NULL");
  await column(
    "chp_event_participants",
    "attended",
    "TINYINT(1) NOT NULL DEFAULT 0",
  );
  for (const [table, name, columns] of [
    ["chp_users", "idx_user_directory", "role,status,disabled,name"],
    [
      "chp_events",
      "idx_event_discovery",
      "status,lifecycle,event_date,start_time",
    ],
    ["chp_event_participants", "idx_volunteer_events", "volunteer_id,event_id"],
  ]) {
    const [rows] = await db.execute(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?",
      [table, name],
    );
    if (!rows.length)
      await db.query(
        "CREATE INDEX " + name + " ON " + table + " (" + columns + ")",
      );
  }
};
