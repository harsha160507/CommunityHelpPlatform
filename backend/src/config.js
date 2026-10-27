"use strict";
require("dotenv").config();
const { DateTime } = require("luxon");
function configuration(env = process.env) {
  const production = env.NODE_ENV === "production";
  const baseUrl = new URL(env.BASE_URL || "http://localhost:3000");
  if (production && baseUrl.protocol !== "https:")
    throw new Error("Production BASE_URL must use HTTPS.");
  if (
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash ||
    baseUrl.username ||
    baseUrl.password
  )
    throw new Error("BASE_URL must contain only the public origin.");
  const timezone = env.EVENT_TIMEZONE || "UTC";
  if (!DateTime.now().setZone(timezone).isValid)
    throw new Error("Invalid EVENT_TIMEZONE.");
  const preview = !production && env.DEV_MAIL_PREVIEW === "true";
  if (!preview && (!env.SMTP_HOST || !env.MAIL_FROM))
    throw new Error(
      "Configure SMTP_HOST and MAIL_FROM, or enable development mail preview.",
    );
  const port = Number(env.PORT || 3000);
  const trustProxy = Number(env.TRUST_PROXY || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  if (![0, 1].includes(trustProxy))
    throw new Error("TRUST_PROXY must be 0 or 1.");
  return {
    production,
    baseUrl: baseUrl.origin,
    timezone,
    preview,
    port,
    trustProxy,
  };
}
module.exports = { configuration };
