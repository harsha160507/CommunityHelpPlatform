"use strict";
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  request = require("supertest"),
  fs = require("node:fs/promises"),
  bcrypt = require("bcryptjs");
const { DateTime } = require("luxon"),
  { createPool } = require("../../backend/src/db"),
  { migrate } = require("../../backend/scripts/migrate"),
  { setupAdmin } = require("../../backend/scripts/admin");
const { createApp } = require("../../backend/src/app"),
  { configuration } = require("../../backend/src/config");
const PASSWORD = "Test-only secure phrase 47!";
let pool, app, admin, ngo, volunteer, second, event;
const cfg = configuration({
  DEV_MAIL_PREVIEW: "true",
  BASE_URL: "http://localhost:3000",
  EVENT_TIMEZONE: "Asia/Kolkata",
});
const send = (method, path, token, body) => {
  const r = request(app)[method]("/api" + path);
  if (token) r.set("Authorization", "Bearer " + token);
  return body === undefined ? r : r.send(body);
};
async function row(table, id) {
  const [rows] = await pool.execute("SELECT * FROM " + table + " WHERE id=?", [
    id,
  ]);
  return rows[0];
}
async function latestLink(email, purpose) {
  const [rows] = await pool.execute(
    "SELECT body FROM chp_mail_outbox WHERE recipient=? ORDER BY id DESC LIMIT 1",
    [email],
  );
  assert.ok(rows.length);
  return rows[0].body.match(
    new RegExp("#" + purpose + "\\?token=([a-f0-9]{64})"),
  )[1];
}
async function account(role, name) {
  const email = name + "@example.test";
  await send("post", "/auth/register", null, {
    name,
    email,
    password: PASSWORD,
    role,
    description: role === "ngo" ? "Community support organization" : "",
    phone: "12345",
    location: "Test City",
  }).expect(201);
  const verify = await latestLink(email, "verify");
  await send("post", "/auth/verify", null, { token: verify }).expect(200);
  const result = await send("post", "/auth/login", null, {
    email,
    password: PASSWORD,
  }).expect(200);
  const me = await send("get", "/auth/me", result.body.token).expect(200);
  return { token: result.body.token, ...me.body.user };
}
async function reviewNGO(status, reason = "") {
  const u = await row("chp_users", ngo.id);
  return send("patch", "/admin/ngos/" + u.id, admin.token, {
    status,
    reason,
    version: u.version,
    expectedStatus: u.status,
  });
}
async function reviewEvent(status, reason = "") {
  const e = await row("chp_events", event.id);
  return send("patch", "/admin/events/" + e.id, admin.token, {
    status,
    reason,
    version: e.version,
    expectedStatus: e.status,
  });
}
before(async () => {
  if (
    process.env.ALLOW_TEST_DB_RESET !== "1" ||
    !/_test$/.test(process.env.DB_NAME || "")
  )
    throw new Error(
      "Integration tests require ALLOW_TEST_DB_RESET=1 and a DB_NAME ending _test. They erase that test database.",
    );
  pool = createPool();
  const db = await pool.getConnection();
  try {
    await db.query("SET FOREIGN_KEY_CHECKS=0");
    const [tables] = await db.query("SHOW TABLES");
    for (const t of tables)
      await db.query("DROP TABLE ??", [Object.values(t)[0]]);
    await db.query("SET FOREIGN_KEY_CHECKS=1");
    const initial = await fs.readFile(
      require("node:path").join(
        __dirname,
        "../../database/migrations/001_initial.sql",
      ),
      "utf8",
    );
    for (const sql of initial.split(";").filter((s) => s.trim()))
      await db.query(sql);
    await db.execute(
      "INSERT INTO chp_users(name,email,password_hash,role,status) VALUES ('Legacy admin','legacy@example.test',?,'admin','approved')",
      [await bcrypt.hash("Admin123!", 10)],
    );
  } finally {
    db.release();
  }
  await migrate(pool);
  await migrate(pool);
  await setupAdmin(pool, {
    ADMIN_EMAIL: "admin@example.test",
    ADMIN_PASSWORD: PASSWORD,
  });
  app = createApp({
    pool,
    config: cfg,
    rateLimits: false,
    logger: { info() {}, error() {} },
  });
  const result = await send("post", "/auth/login", null, {
    email: "admin@example.test",
    password: PASSWORD,
  }).expect(200);
  admin = { token: result.body.token };
  ngo = await account("ngo", "help-ngo");
  volunteer = await account("volunteer", "volunteer-one");
  second = await account("volunteer", "volunteer-two");
});
after(async () => {
  if (pool) await pool.end();
});
test("migration preserves old data, disables legacy admins and runs idempotently", async () => {
  const [old] = await pool.execute(
    "SELECT disabled,email_verified FROM chp_users WHERE email='legacy@example.test'",
  );
  assert.equal(old[0].disabled, 1);
  assert.equal(old[0].email_verified, 0);
  const [[count]] = await pool.query(
    "SELECT COUNT(*) AS total FROM chp_schema_migrations",
  );
  assert.equal(count.total, 3);
  await assert.rejects(
    setupAdmin(pool, {
      ADMIN_EMAIL: volunteer.email,
      ADMIN_PASSWORD: PASSWORD,
    }),
    /non-admin/,
  );
});
test("same-origin frontend, health, CSP, JSON errors and pagination", async () => {
  await request(app)
    .get("/")
    .expect(200)
    .expect("Content-Type", /html/)
    .expect("Content-Security-Policy", /script-src 'self'/);
  await request(app).get("/app.js").expect(200);
  await request(app).get("/.env").expect(404);
  await request(app).get("/health/ready").expect(200);
  await send("get", "/events?page=0").expect(400);
  await send("post", "/auth/login", null, []).expect(400);
  await send("post", "/auth/login", null, {})
    .set("Origin", "https://other.example")
    .expect(403);
  await send("get", "/no-such-route").expect(404);
});
test("server validation and email verification cannot be bypassed", async () => {
  await send("post", "/auth/register", null, {
    name: " ",
    email: "bad",
    password: "123456",
    role: "ngo",
  }).expect(400);
  const body = {
    name: "Unverified",
    email: "unverified@example.test",
    password: PASSWORD,
    role: "volunteer",
  };
  await send("post", "/auth/register", null, body).expect(201);
  await send("post", "/auth/login", null, {
    email: body.email,
    password: PASSWORD,
  }).expect(403);
  const token = await latestLink(body.email, "verify");
  await send("post", "/auth/verify", null, { token }).expect(200);
  await send("post", "/auth/verify", null, { token }).expect(400);
});
test("registration uniqueness races return conflict rather than server failure", async () => {
  const body = {
    name: "Race",
    email: "race@example.test",
    password: PASSWORD,
    role: "volunteer",
  };
  const responses = await Promise.all([
    send("post", "/auth/register", null, body),
    send("post", "/auth/register", null, body),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
});
test("NGO review requires current version and produces persistent feedback", async () => {
  await send("post", "/events", ngo.token, { title: "x" }).expect(400);
  await send("patch", "/admin/ngos/" + ngo.id, admin.token, {
    status: "approved",
    version: 999,
    expectedStatus: "pending",
  }).expect(409);
  await reviewNGO("approved").then((r) => assert.equal(r.status, 200));
  await send("patch", "/admin/ngos/" + ngo.id, volunteer.token, {
    status: "approved",
    version: 1,
    expectedStatus: "pending",
  }).expect(403);
});
test("event validation, approval, idempotency and directory/count consistency", async () => {
  const body = {
    title: "Community meals",
    description: "Help our neighbors",
    location: "Hall",
    event_date: DateTime.now().plus({ days: 5 }).toISODate(),
    start_time: "09:00",
    end_time: "10:00",
    capacity: 1,
  };
  await send("post", "/events", ngo.token, { ...body, title: " " })
    .set("Idempotency-Key", "event-validation-12345")
    .expect(400);
  await send("post", "/events", ngo.token, {
    ...body,
    event_date: "2000-01-01",
  })
    .set("Idempotency-Key", "event-validation-12345")
    .expect(400);
  const created = await send("post", "/events", ngo.token, body)
    .set("Idempotency-Key", "event-create-once-12345")
    .expect(201);
  event = { id: created.body.id, ...body };
  const replay = await send("post", "/events", ngo.token, body)
    .set("Idempotency-Key", "event-create-once-12345")
    .expect(200);
  assert.equal(replay.body.id, event.id);
  await reviewEvent("approved").then((r) => assert.equal(r.status, 200));
  const listed = await send("get", "/events").expect(200),
    stats = await send("get", "/stats").expect(200);
  assert.equal(listed.body.pagination.total, 1);
  assert.equal(stats.body.events, 1);
  assert.match(listed.body.events[0].event_date, /^\d{4}-\d{2}-\d{2}$/);
});
test("concurrent joins cannot exceed capacity, duplicate joins conflict, rosters stay owner-only", async () => {
  const responses = await Promise.all([
    send(
      "post",
      "/volunteers/events/" + event.id + "/join",
      volunteer.token,
      {},
    ),
    send("post", "/volunteers/events/" + event.id + "/join", second.token, {}),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const winner = responses[0].status === 201 ? volunteer : second;
  await send(
    "post",
    "/volunteers/events/" + event.id + "/join",
    winner.token,
    {},
  ).expect(409);
  const roster = await send(
    "get",
    "/events/" + event.id + "/participants",
    ngo.token,
  ).expect(200);
  assert.equal(roster.body.pagination.total, 1);
  await send(
    "get",
    "/events/" + event.id + "/participants",
    volunteer.token,
  ).expect(403);
  await send(
    "delete",
    "/volunteers/events/" + event.id + "/join",
    winner.token,
    {},
  ).expect(200);
  await send(
    "post",
    "/volunteers/events/" + event.id + "/join",
    volunteer.token,
    {},
  ).expect(201);
});
test("NGO rejection hides events, blocks direct joins, changes counts and notifies participants", async () => {
  await reviewNGO("rejected", "Please provide supporting information.").then(
    (r) => assert.equal(r.status, 200),
  );
  const list = await send("get", "/events").expect(200),
    stats = await send("get", "/stats").expect(200);
  assert.equal(list.body.pagination.total, 0);
  assert.equal(stats.body.events, 0);
  await send(
    "post",
    "/volunteers/events/" + event.id + "/join",
    second.token,
    {},
  ).expect(409);
  const joined = await send(
    "get",
    "/volunteers/my-events",
    volunteer.token,
  ).expect(200);
  assert.equal(joined.body.events[0].ngo_status, "rejected");
  const activity = await send("get", "/activity", volunteer.token).expect(200);
  assert(
    activity.body.activity.some((a) =>
      a.message.includes("Organizer review changed"),
    ),
  );
  await reviewNGO("approved").then((r) => assert.equal(r.status, 200));
});
test("event edits trigger re-review, stale decisions conflict, rejection reaches participants", async () => {
  const e = await row("chp_events", event.id);
  await send("put", "/events/" + event.id, ngo.token, {
    ...event,
    title: "Updated meals",
    version: e.version,
  }).expect(200);
  await send("patch", "/admin/events/" + event.id, admin.token, {
    status: "approved",
    version: e.version,
    expectedStatus: e.status,
  }).expect(409);
  await reviewEvent("rejected", "Please clarify the venue.").then((r) =>
    assert.equal(r.status, 200),
  );
  const joined = await send(
    "get",
    "/volunteers/my-events",
    volunteer.token,
  ).expect(200);
  assert.equal(joined.body.events[0].status, "rejected");
  await reviewEvent("approved").then((r) => assert.equal(r.status, 200));
});
test("same-day past-start events cannot be joined or counted", async () => {
  const e = await row("chp_events", event.id);
  await pool.execute(
    "UPDATE chp_events SET event_date=?,start_time='00:00:00',end_time='00:01:00' WHERE id=?",
    [DateTime.now().setZone(cfg.timezone).toISODate(), event.id],
  );
  await send(
    "post",
    "/volunteers/events/" + event.id + "/join",
    second.token,
    {},
  ).expect(409);
  assert.equal((await send("get", "/stats")).body.events, 0);
  await pool.execute(
    "UPDATE chp_events SET event_date=?,start_time=?,end_time=? WHERE id=?",
    [e.event_date, e.start_time, e.end_time, event.id],
  );
});
test("cancellation notifies volunteers and still permits withdrawal", async () => {
  const e = await row("chp_events", event.id);
  await send("post", "/events/" + event.id + "/cancel", ngo.token, {
    version: e.version,
  }).expect(200);
  assert.equal(
    (await send("get", "/volunteers/my-events", volunteer.token)).body.events[0]
      .lifecycle,
    "cancelled",
  );
  await send(
    "delete",
    "/volunteers/events/" + event.id + "/join",
    volunteer.token,
    {},
  ).expect(200);
  await send(
    "post",
    "/volunteers/events/" + event.id + "/join",
    second.token,
    {},
  ).expect(409);
});
test("password reset uses expiring single-use tokens and revokes sessions", async () => {
  await send("post", "/auth/forgot-password", null, {
    email: second.email,
  }).expect(200);
  const reset = await latestLink(second.email, "reset");
  await send("post", "/auth/reset", null, {
    token: reset,
    password: "Another test-only phrase 84!",
  }).expect(200);
  await send("get", "/auth/me", second.token).expect(401);
  await send("post", "/auth/reset", null, {
    token: reset,
    password: PASSWORD,
  }).expect(400);
});
test("logout revokes copied tokens and disabled users lose access", async () => {
  const logged = await send("post", "/auth/login", null, {
      email: volunteer.email,
      password: PASSWORD,
    }).expect(200),
    copy = logged.body.token;
  await send("post", "/auth/logout", copy, {}).expect(200);
  await send("get", "/auth/me", copy).expect(401);
  const u = await row("chp_users", volunteer.id);
  await send("patch", "/admin/volunteers/" + u.id, admin.token, {
    disabled: true,
    version: u.version,
  }).expect(200);
  await send("get", "/auth/me", volunteer.token).expect(401);
});
test("account deletion anonymizes the account and invalidates sessions", async () => {
  const disposable = await account("volunteer", "delete-me");
  await send("delete", "/auth/account", disposable.token, {
    password: PASSWORD,
  }).expect(200);
  const u = await row("chp_users", disposable.id);
  assert.equal(u.name, "Deleted account");
  assert.equal(u.disabled, 1);
  assert.match(u.email, /@invalid.local$/);
  await send("get", "/auth/me", disposable.token).expect(401);
});
test("authentication rate limiting returns a JSON 429", async () => {
  const limited = createApp({
    pool,
    config: cfg,
    logger: { info() {}, error() {} },
  });
  let result;
  for (let i = 0; i < 21; i++)
    result = await request(limited).post("/api/auth/login").send({});
  assert.equal(result.status, 429);
  assert.match(result.body.message, /Too many/);
});

test("completed events support owner attendance and retain historical registration", async () => {
  const [result] = await pool.execute(
    "INSERT INTO chp_events(ngo_id,title,description,event_date,location,start_time,end_time,capacity,status) VALUES (?,'Completed activity','Test attendance',?,'Hall','00:00','00:01',2,'approved')",
    [
      ngo.id,
      DateTime.now().setZone(cfg.timezone).minus({ days: 1 }).toISODate(),
    ],
  );
  const id = result.insertId;
  await pool.execute(
    "INSERT INTO chp_event_participants(event_id,volunteer_id) VALUES (?,?)",
    [id, second.id],
  );
  await send("post", "/events/" + id + "/complete", ngo.token, {
    version: 1,
  }).expect(200);
  await send(
    "patch",
    "/events/" + id + "/participants/" + second.id,
    ngo.token,
    { attended: true },
  ).expect(200);
  const [records] = await pool.execute(
    "SELECT attended FROM chp_event_participants WHERE event_id=?",
    [id],
  );
  assert.equal(records[0].attended, 1);
});
test("NGO profile corrections submit the organizer for a fresh review", async () => {
  const me = (await send("get", "/auth/me", ngo.token)).body.user;
  await send("put", "/auth/profile", ngo.token, {
    name: me.name,
    description: "Corrected review details",
    version: me.version,
  }).expect(200);
  assert.equal((await row("chp_users", ngo.id)).status, "pending");
  await send("put", "/auth/profile", ngo.token, {
    name: me.name,
    description: "Stale update",
    version: me.version,
  }).expect(409);
  await reviewNGO("approved").then((r) => assert.equal(r.status, 200));
});
test("password changes revoke every session and expired reset links are rejected", async () => {
  const u = await account("volunteer", "password-change");
  await send("post", "/auth/change-password", u.token, {
    currentPassword: PASSWORD,
    password: "New secure test phrase 90!",
  }).expect(200);
  await send("get", "/auth/me", u.token).expect(401);
  await send("post", "/auth/forgot-password", null, { email: u.email }).expect(
    200,
  );
  const reset = await latestLink(u.email, "reset");
  await pool.execute(
    "UPDATE chp_account_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE user_id=?",
    [u.id],
  );
  await send("post", "/auth/reset", null, {
    token: reset,
    password: PASSWORD,
  }).expect(400);
});
test("deleting an NGO cancels its remaining events and removes identity fields", async () => {
  const u = await account("ngo", "delete-ngo");
  await send("patch", "/admin/ngos/" + u.id, admin.token, {
    status: "approved",
    version: u.version,
    expectedStatus: "pending",
  }).expect(200);
  const created = await send("post", "/events", u.token, {
    title: "Deletion activity",
    description: "Test cancellation",
    event_date: DateTime.now().plus({ days: 4 }).toISODate(),
    start_time: "09:00",
    end_time: "10:00",
    location: "Hall",
    capacity: 2,
  })
    .set("Idempotency-Key", "delete-ngo-event-123456")
    .expect(201);
  await send("delete", "/auth/account", u.token, { password: PASSWORD }).expect(
    200,
  );
  assert.equal(
    (await row("chp_events", created.body.id)).lifecycle,
    "cancelled",
  );
  assert.equal((await row("chp_users", u.id)).disabled, 1);
  await send("get", "/auth/me", u.token).expect(401);
});
test("mail outbox retains failures for retry and clears bodies after successful delivery", async (t) => {
  const nodemailer = require("nodemailer"),
    { mailWorker } = require("../../backend/src/mail");
  await pool.execute("DELETE FROM chp_mail_outbox");
  await pool.execute(
    "INSERT INTO chp_mail_outbox(recipient,subject,body) VALUES ('fixture@example.test','Test','Fixture message')",
  );
  let fail = true;
  const mock = t.mock.method(nodemailer, "createTransport", () => ({
    async sendMail() {
      if (fail) throw new Error("SMTP unavailable");
    },
    close() {},
  }));
  const worker = mailWorker(
    pool,
    { preview: false },
    { SMTP_HOST: "smtp.example.test", MAIL_FROM: "fixture@example.test" },
    { error() {} },
  );
  await worker.tick();
  let [[mail]] = await pool.query("SELECT * FROM chp_mail_outbox");
  assert.equal(mail.attempts, 1);
  assert.equal(mail.body, "Fixture message");
  assert.equal(mail.sent_at, null);
  fail = false;
  await worker.tick();
  [[mail]] = await pool.query("SELECT * FROM chp_mail_outbox");
  assert.equal(mail.attempts, 2);
  assert.equal(mail.body, "");
  assert.ok(mail.sent_at);
  worker.close();
  mock.mock.restore();
});
