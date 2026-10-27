"use strict";
const { DateTime } = require("luxon");
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (message) => {
  throw new HttpError(400, message);
};
function text(value, label, max, required = true) {
  if (value === undefined || value === null) {
    if (!required) return null;
    fail(label + " is required.");
  }
  if (typeof value !== "string") fail(label + " must be text.");
  const clean = value.trim();
  if ((!clean && required) || clean.length > max)
    fail(
      label +
        " must contain " +
        (required ? "1" : "0") +
        "–" +
        max +
        " characters.",
    );
  return clean || null;
}
function email(value) {
  const clean = text(value, "Email", 190).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))
    fail("Enter a valid email address.");
  return clean;
}
function password(value) {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    Buffer.byteLength(value, "utf8") > 72
  )
    fail(
      "Password must contain at least 12 characters and at most 72 UTF-8 bytes.",
    );
  return value;
}
function positive(value, label = "ID", max = Number.MAX_SAFE_INTEGER) {
  if (
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > max
  )
    fail("Invalid " + label + ".");
  return Number(value);
}
function page(query = {}) {
  const number =
    query.page === undefined ? 1 : positive(query.page, "page", 100000);
  const limit =
    query.limit === undefined ? 12 : positive(query.limit, "limit", 50);
  return { number, limit, offset: (number - 1) * limit };
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    fail("A current integer version is required. Refresh and retry.");
  return value;
}
function profile(body, role) {
  return {
    name: text(body.name, "Name", 100),
    phone: text(body.phone, "Phone", 30, false),
    location: text(body.location, "Location", 200, false),
    interest: text(body.interest, "Interests", 255, false),
    description: text(
      body.description,
      "NGO description",
      10000,
      role === "ngo",
    ),
  };
}
function eventTime(date, time, zone) {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(time)
  )
    fail("Use a valid date and time (HH:MM).");
  const normalized = time.slice(0, 5);
  const result = DateTime.fromISO(date + "T" + normalized, { zone });
  if (
    !result.isValid ||
    result.toFormat("yyyy-MM-dd'T'HH:mm") !== date + "T" + normalized
  )
    fail("The event date or local time does not exist.");
  if (result.getPossibleOffsets().length !== 1)
    fail("This time is ambiguous due to daylight saving. Choose another time.");
  return result;
}
function event(body, zone, now = DateTime.now()) {
  const start = eventTime(body.event_date, body.start_time, zone);
  const end = eventTime(body.event_date, body.end_time, zone);
  if (end <= start)
    fail("End time must be later than start time on the same day.");
  if (start <= now) fail("Events must start in the future.");
  return {
    title: text(body.title, "Title", 200),
    description: text(body.description, "Description", 10000),
    location: text(body.location, "Location", 255),
    event_date: body.event_date,
    start_time: start.toFormat("HH:mm:ss"),
    end_time: end.toFormat("HH:mm:ss"),
    capacity: positive(body.capacity, "capacity", 10000),
  };
}
function upcoming(row, zone, now = DateTime.now()) {
  return eventTime(row.event_date, row.start_time, zone) > now;
}
function cutoff(zone) {
  const now = DateTime.now().setZone(zone);
  return [now.toISODate(), now.toFormat("HH:mm:ss")];
}
module.exports = {
  HttpError,
  text,
  email,
  password,
  positive,
  page,
  version,
  profile,
  event,
  eventTime,
  upcoming,
  cutoff,
};
