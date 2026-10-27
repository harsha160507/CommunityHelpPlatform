"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { DateTime } = require("luxon");
const v = require("../../backend/src/validation"),
  { configuration } = require("../../backend/src/config"),
  { hash } = require("../../backend/src/services");
const input = {
  title: "Food drive",
  description: "Help distribute meals",
  location: "Community hall",
  event_date: "2099-05-01",
  start_time: "09:00",
  end_time: "10:00",
  capacity: 20,
};
test("normalizes values and uses matching capacity bounds", () => {
  assert.equal(v.event(input, "UTC").capacity, 20);
  assert.equal(v.event({ ...input, title: " Food " }, "UTC").title, "Food");
  assert.throws(
    () => v.event({ ...input, capacity: 10001 }, "UTC"),
    /capacity/,
  );
});
test("rejects whitespace required fields and malformed field types", () => {
  for (const key of ["title", "description", "location"])
    assert.throws(() => v.event({ ...input, [key]: "  " }, "UTC"));
  assert.throws(() => v.email("not-an-email"));
  assert.throws(() => v.profile({ name: "   " }, "volunteer"));
  assert.throws(() => v.profile({ name: "Example", description: "" }, "ngo"));
  assert.throws(() => v.text({}, "Name", 100));
});
test("password uses twelve-character minimum and bcrypt byte ceiling", () => {
  assert.throws(() => v.password("12345678901"));
  assert.throws(() => v.password("é".repeat(37)));
  assert.equal(v.password("é".repeat(36)).length, 36);
});
test("dates, padded times, end time, DST and registration cutoff are checked", () => {
  for (const patch of [
    { event_date: "2026-02-30" },
    { start_time: "9:00" },
    { end_time: "08:00" },
    { event_date: "2000-01-01" },
  ])
    assert.throws(() => v.event({ ...input, ...patch }, "UTC"));
  assert.throws(
    () => v.eventTime("2026-03-08", "02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => v.eventTime("2026-11-01", "01:30", "America/New_York"),
    /ambiguous/,
  );
  assert.equal(
    v.upcoming(input, "UTC", DateTime.fromISO("2099-05-01T09:00Z")),
    false,
  );
});
test("pagination and optimistic versions reject malformed numbers", () => {
  assert.deepEqual(v.page({ page: "2", limit: "12" }), {
    number: 2,
    limit: 12,
    offset: 12,
  });
  for (const value of ["0", "-1", "1e2", "1.5", "abc"])
    assert.throws(() => v.positive(value));
  assert.throws(() => v.page({ limit: "51" }));
  assert.throws(() => v.version("1"));
});
test("production requires HTTPS, SMTP and a valid timezone", () => {
  assert.throws(
    () =>
      configuration({
        NODE_ENV: "production",
        BASE_URL: "http://example.test",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      configuration({
        NODE_ENV: "production",
        BASE_URL: "https://example.test",
      }),
    /SMTP/,
  );
  assert.throws(
    () =>
      configuration({ DEV_MAIL_PREVIEW: "true", EVENT_TIMEZONE: "bad-zone" }),
    /TIMEZONE/,
  );
  assert.equal(
    configuration({ DEV_MAIL_PREVIEW: "true", EVENT_TIMEZONE: "Asia/Kolkata" })
      .timezone,
    "Asia/Kolkata",
  );
  assert.equal(hash("x").length, 64);
});
