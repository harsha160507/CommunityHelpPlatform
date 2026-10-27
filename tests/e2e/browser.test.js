"use strict";
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  { chromium, expect } = require("@playwright/test"),
  AxeBuilder = require("@axe-core/playwright").default;
const { DateTime } = require("luxon"),
  { createPool } = require("../../backend/src/db"),
  { createApp } = require("../../backend/src/app"),
  { configuration } = require("../../backend/src/config"),
  { setupAdmin } = require("../../backend/scripts/admin");
const EVENT_TITLE = "Browser community event " + Date.now();
const PASSWORD = "Browser-only secure phrase 65!",
  origin = "http://127.0.0.1:33418";
let pool, server, browser, page, admin, ngo, volunteer, eventId;
async function api(method, path, token, body) {
  const response = await fetch(origin + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  return { status: response.status, ...data };
}
async function login(email) {
  await page.goto(origin + "/#login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview & activity", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#content")).toHaveAttribute("aria-busy", "false");
}
async function fixture(role, name) {
  const email = name + "@example.test";
  let result = await api("POST", "/auth/register", null, {
    name,
    email,
    role,
    password: PASSWORD,
    description: role === "ngo" ? "Browser test community NGO" : "",
  });
  assert.equal(result.status, 201);
  const [messages] = await pool.execute(
    "SELECT body FROM chp_mail_outbox WHERE recipient=? ORDER BY id DESC LIMIT 1",
    [email],
  );
  const token = messages[0].body.match(/token=([a-f0-9]{64})/)[1];
  assert.equal(
    (await api("POST", "/auth/verify", null, { token })).status,
    200,
  );
  result = await api("POST", "/auth/login", null, {
    email,
    password: PASSWORD,
  });
  const me = await api("GET", "/auth/me", result.token);
  return { ...me.user, token: result.token };
}
before(async () => {
  if (!/_test$/.test(process.env.DB_NAME || ""))
    throw new Error("Browser tests require a DB_NAME ending _test.");
  pool = createPool();
  await setupAdmin(pool, {
    ADMIN_EMAIL: "browser-admin@example.test",
    ADMIN_PASSWORD: PASSWORD,
  });
  const config = configuration({
    DEV_MAIL_PREVIEW: "true",
    BASE_URL: origin,
    EVENT_TIMEZONE: "Asia/Kolkata",
  });
  server = createApp({
    pool,
    config,
    rateLimits: false,
    logger: { info() {}, error() {} },
  }).listen(33418, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  admin = await api("POST", "/auth/login", null, {
    email: "browser-admin@example.test",
    password: PASSWORD,
  });
  const suffix = Date.now();
  ngo = await fixture("ngo", "browser-ngo-" + suffix);
  volunteer = await fixture("volunteer", "browser-volunteer-" + suffix);
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool?.end();
});
test("guests can browse without login; desktop and mobile pass accessibility checks", async () => {
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Community events", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#content")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("link", { name: "NGO directory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "NGO directory", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Skip to content", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  assert.equal(new URL(page.url()).hash, "#directory");
  await page.goto(origin);
  await expect(page.locator("#content")).toHaveAttribute("aria-busy", "false");
  let result = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    result.violations.map((v) => v.id),
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth + 1,
    ),
  );
  result = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    result.violations.map((v) => v.id),
    [],
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
});
test("NGO can create an event and admin can inspect and approve all details", async () => {
  const reviewed = await api("PATCH", "/admin/ngos/" + ngo.id, admin.token, {
    status: "approved",
    version: ngo.version,
    expectedStatus: ngo.status,
  });
  assert.equal(reviewed.status, 200);
  await login(ngo.email);
  await page.getByRole("link", { name: "My NGO events", exact: true }).click();
  await page.getByRole("link", { name: "Create event", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(EVENT_TITLE);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Detailed volunteering tasks for review.");
  await page
    .getByLabel("Date", { exact: true })
    .fill(DateTime.now().plus({ days: 10 }).toISODate());
  await page.getByLabel("Start time", { exact: false }).fill("09:00");
  await page.getByLabel("End time", { exact: false }).fill("10:00");
  await page.getByLabel("Location", { exact: true }).fill("Browser test hall");
  await page.getByLabel("Volunteer capacity").fill("2");
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: EVENT_TITLE, exact: true }),
  ).toBeVisible();
  const [events] = await pool.execute(
    "SELECT id FROM chp_events WHERE ngo_id=?",
    [ngo.id],
  );
  eventId = events[0].id;
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator("#profileRole")).toHaveText("guest");
  await login("browser-admin@example.test");
  await page.getByRole("link", { name: "Review events", exact: true }).click();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: EVENT_TITLE,
      exact: true,
    }),
  });
  await expect(card).toContainText("Detailed volunteering tasks for review.");
  await expect(card).toContainText("0 / 2 participants");
  await card
    .getByRole("button", { name: "Approve / restore", exact: true })
    .click();
  await expect(card).toContainText("approved");
  const result = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    result.violations.map((v) => v.id),
    [],
  );
});
test("volunteer joins, organizer sees roster, and withdrawal updates availability", async () => {
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator("#profileRole")).toHaveText("guest");
  await login(volunteer.email);
  await expect(
    page.getByRole("link", { name: "Review history", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Community events", exact: true })
    .click();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: EVENT_TITLE,
      exact: true,
    }),
  });
  await card.getByRole("button", { name: "Participate", exact: true }).click();
  await expect(card).toContainText("1 / 2 participants");
  const roster = await api(
    "GET",
    "/events/" + eventId + "/participants",
    ngo.token,
  );
  assert.equal(roster.participants[0].email, volunteer.email);
  await page
    .getByRole("link", { name: "My registrations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: EVENT_TITLE, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.locator("#content")).toContainText(
    "No events on this page.",
  );
});
test("revoked session clears protected content and returns to login", async () => {
  await pool.execute("DELETE FROM chp_sessions WHERE user_id=?", [
    volunteer.id,
  ]);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "My registrations", exact: true }),
  ).toHaveCount(0);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("chp_session")),
    null,
  );
});
test("signup, emailed verification and password recovery work in the browser", async () => {
  const email = "browser-signup-" + Date.now() + "@example.test";
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await page.getByLabel("Full name / organisation name").fill("Browser signup");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("New password", { exact: false }).fill(PASSWORD);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Check your email");
  let [messages] = await pool.execute(
    "SELECT body FROM chp_mail_outbox WHERE recipient=? ORDER BY id DESC LIMIT 1",
    [email],
  );
  let link = messages[0].body.match(/https?:\/\/\S+/)[0];
  await page.goto(link);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Email verified");
  await login(email);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator("#profileRole")).toHaveText("guest");
  await page
    .getByRole("link", { name: "Account recovery", exact: true })
    .click();
  const resetForm = page.locator('form[data-kind="forgot-password"]');
  await resetForm.getByLabel("Email address", { exact: true }).fill(email);
  await resetForm.getByRole("button").click();
  await expect(page.locator("#notice")).toContainText("eligible");
  [messages] = await pool.execute(
    "SELECT body FROM chp_mail_outbox WHERE recipient=? ORDER BY id DESC LIMIT 1",
    [email],
  );
  link = messages[0].body.match(/https?:\/\/\S+/)[0];
  await page.goto(link);
  await page
    .getByLabel("New password", { exact: false })
    .fill(PASSWORD + "new");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Password reset");
});
